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
export async function pickWorkbook(): Promise<{ file: File; handle?: FileSystemFileHandle } | null> {
  const w = window as PickerWindow;
  if (!w.showOpenFilePicker) return null;
  try {
    const [handle] = await w.showOpenFilePicker({ types: XLSX_TYPES, multiple: false });
    return { file: await handle.getFile(), handle };
  } catch (e) {
    if ((e as Error).name === "AbortError") return null;
    throw e;
  }
}

export async function writeToHandle(handle: FileSystemFileHandle, data: ArrayBuffer) {
  const h = handle as PermHandle;
  if (h.queryPermission && (await h.queryPermission({ mode: "readwrite" })) !== "granted") {
    const p = await h.requestPermission?.({ mode: "readwrite" });
    if (p !== "granted") throw new Error("Permission to write the file was denied.");
  }
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}
