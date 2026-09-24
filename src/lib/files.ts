"use client";

type PickerWindow = Window & {
  showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]>;
};

type PermHandle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
};

export const canWriteInPlace = () => typeof window !== "undefined" && "showOpenFilePicker" in window;

const XLSX_TYPES = [
  {
    description: "Excel workbook",
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
  },
];

/** Chrome/Edge: open with a handle so we can save back to the same file on disk. */
export async function pickWorkbook(): Promise<{ file: File; buffer: ArrayBuffer; handle: FileSystemFileHandle } | null> {
  const w = window as PickerWindow;
  if (!w.showOpenFilePicker) return null;
  try {
    const [handle] = await w.showOpenFilePicker({ types: XLSX_TYPES, multiple: false });
    return { ...(await readHandle(handle)), handle };
  } catch (e) {
    if ((e as Error).name === "AbortError") return null;
    throw e;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read the file behind a handle, retrying Chrome's NotReadableError ("state cached in an interface
 * object … changed since it was read from disk"). That error happens when OneDrive / Excel touches the
 * file between getFile() and reading its bytes (cloud placeholder hydrating, sync, autosave).
 */
export async function readHandle(handle: FileSystemFileHandle, attempts = 5): Promise<{ file: File; buffer: ArrayBuffer }> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      return { file, buffer };
    } catch (e) {
      last = e;
      if ((e as DOMException).name !== "NotReadableError") break;
      await sleep(400 * (i + 1));
    }
  }
  throw friendlyFileError(last);
}

/** Read a File from <input type=file>; it can't be refreshed, so explain how to recover. */
export async function readFile(file: File): Promise<ArrayBuffer> {
  try {
    return await file.arrayBuffer();
  } catch (e) {
    throw friendlyFileError(e);
  }
}

export function friendlyFileError(e: unknown): Error {
  const name = (e as DOMException)?.name;
  if (name === "NotReadableError")
    return new Error(
      "The file changed on disk while it was being read (usually OneDrive syncing or Excel saving). " +
        "Close it in Excel, wait for OneDrive to finish syncing (or right-click → “Always keep on this device”), then try again.",
    );
  if (name === "NoModificationAllowedError" || name === "InvalidStateError")
    return new Error("Couldn't write the file: it's probably open in Excel or still syncing. Close it in Excel and try again.");
  if (name === "NotAllowedError") return new Error("The browser wasn't given permission to access the file. Click again and choose “Allow”.");
  return e instanceof Error ? e : new Error(String(e));
}

/** Handles restored from IndexedDB after a reload need permission re-granted (one click). */
export async function ensureWritePermission(handle: FileSystemFileHandle) {
  const h = handle as PermHandle;
  if (h.queryPermission && (await h.queryPermission({ mode: "readwrite" })) !== "granted") {
    const p = await h.requestPermission?.({ mode: "readwrite" });
    if (p !== "granted") throw new Error("Permission to edit the file was denied. Click Save again and choose “Edit file” / “Allow”.");
  }
}

export async function writeToHandle(handle: FileSystemFileHandle, data: ArrayBuffer) {
  await ensureWritePermission(handle);
  try {
    const w = await handle.createWritable();
    await w.write(data);
    await w.close();
  } catch (e) {
    throw friendlyFileError(e);
  }
}
