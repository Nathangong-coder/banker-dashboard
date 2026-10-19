"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Images, Loader2, TriangleAlert } from "lucide-react";
import { Button, Card, Select, Textarea } from "@/components/ui";
import type { CalendarSession } from "@/lib/infoSessions";

/**
 * Phone capture for info sessions (no dashboard store): photos of name tags / sign-in sheets, Zoom screenshots or typed
 * names go to the server inbox (api/server/capture), where the dashboard pulls them and extracts the people. The key
 * comes from the link's #k= once, then lives in localStorage (so a home-screen icon keeps working) and in a cookie for
 * the share sheet (api/capture-share).
 */

const KEY = "coverage:capture-key";
const MAX_SIDE = 1600;
const MAX_BYTES = 2.5 * 1024 * 1024;

type Phase = { kind: "idle" } | { kind: "sending"; done: number; total: number } | { kind: "ok"; text: string } | { kind: "err"; text: string };

function readKey() {
  const m = window.location.hash.match(/[#&]k=([^&]+)/);
  if (m) {
    const k = decodeURIComponent(m[1]);
    try {
      localStorage.setItem(KEY, k);
    } catch {
      /* private mode: works for this visit only */
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return k;
  }
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

async function post<T>(path: string, key: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(j.error ?? `Server error ${res.status}`), { status: res.status });
  return j;
}

const approxBytes = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);

/** ≤ 1600 px JPEG at q≈0.8 (smaller again if still over 2.5 MB). */
async function downscale(file: File): Promise<string> {
  let src: CanvasImageSource & { width: number; height: number };
  try {
    src = await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      src = img;
    } catch {
      throw new Error(`Couldn't read ${file.name || "that image"}. Try a screenshot or a JPEG/PNG.`);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  for (const [side, q] of [
    [MAX_SIDE, 0.8],
    [1200, 0.7],
    [1000, 0.6],
  ] as const) {
    const scale = Math.min(1, side / Math.max(src.width, src.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(src.width * scale);
    canvas.height = Math.round(src.height * scale);
    canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", q);
    if (approxBytes(out) <= MAX_BYTES) return out;
  }
  throw new Error(`${file.name || "That image"} is too large even after shrinking.`);
}

function label(s: CalendarSession) {
  const title = s.title.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (s.allDay) {
    const [y, m, d] = s.start.split("-").map(Number);
    return `${title} · ${new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
  }
  const at = new Date(s.start);
  return `${title} · ${at.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export default function CapturePage() {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [sessions, setSessions] = useState<CalendarSession[] | null>(null);
  const [calendar, setCalendar] = useState(true);
  const [sessionId, setSessionId] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [banner, setBanner] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const shots = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      await Promise.resolve();
      const k = readKey();
      const q = new URLSearchParams(window.location.search);
      const shared = q.get("shared");
      if (live && shared !== null) {
        const n = Number(shared) || 0;
        const skipped = Number(q.get("skipped")) || 0;
        setBanner(n ? `Saved ${n} shared item${n > 1 ? "s" : ""}${skipped ? ` (${skipped} couldn't be saved)` : ""}. Confirm the names in Coverage → Info sessions.` : "Nothing from the share was saved.");
      }
      if (!live) return;
      setKey(k);
      if (!k) return;
      // Let the share sheet (which can't send headers) use the same key.
      post("/api/capture-share/cookie", k, {}).catch(() => undefined);
      try {
        const r = await post<{ calendar: boolean; sessions: CalendarSession[]; defaultId: string | null }>("/api/server/capture/sessions", k, {});
        if (!live) return;
        setCalendar(r.calendar);
        setSessions(r.sessions);
        setSessionId(r.defaultId ?? "");
      } catch (e) {
        if (!live) return;
        if ((e as { status?: number }).status === 401) {
          try {
            localStorage.removeItem(KEY);
          } catch {
            /* ignore */
          }
          setKey(null);
          setPhase({ kind: "err", text: (e as Error).message });
          return;
        }
        setSessions([]);
        setCalendar(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles((f) => [...f, ...Array.from(list).filter((x) => x.type.startsWith("image/") || !x.type)]);
    setPhase({ kind: "idle" });
  };

  const send = async () => {
    if (!key) return;
    const total = files.length + (text.trim() ? 1 : 0);
    if (!total) return setPhase({ kind: "err", text: "Add a photo, a screenshot or some names first." });
    let done = 0;
    setPhase({ kind: "sending", done, total });
    const failed: string[] = [];
    const sent: File[] = [];
    for (const f of files) {
      try {
        const image = await downscale(f);
        await post("/api/server/capture", key, { image, ...(sessionId ? { sessionId } : {}) });
        sent.push(f);
      } catch (e) {
        failed.push((e as Error).message);
      }
      setPhase({ kind: "sending", done: ++done, total });
    }
    let textSent = !text.trim();
    if (text.trim()) {
      try {
        await post("/api/server/capture", key, { text: text.trim(), ...(sessionId ? { sessionId } : {}) });
        textSent = true;
      } catch (e) {
        failed.push((e as Error).message);
      }
      setPhase({ kind: "sending", done: ++done, total });
    }
    setFiles((list) => list.filter((f) => !sent.includes(f)));
    if (textSent) setText("");
    const ok = total - failed.length;
    if (failed.length)
      setPhase({ kind: "err", text: `${ok ? `Sent ${ok} of ${total}. ` : ""}${[...new Set(failed)].join(" ")} What didn't go through is still here: try again.` });
    else setPhase({ kind: "ok", text: `Sent ${ok} item${ok > 1 ? "s" : ""}. Confirm the names in Coverage → Info sessions on your computer.` });
  };

  const busy = phase.kind === "sending";

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-paper">
      <div className="mx-auto max-w-[520px] px-4 pt-6 pb-16">
        <div className="mb-5">
          <div className="font-serif text-[28px] leading-none text-navy">Coverage</div>
          <div className="mt-1 text-[13px] text-muted">Who did you meet? Send photos of name tags, a sign-in sheet, a Zoom screenshot, or type the names.</div>
        </div>

        {banner && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-line bg-green-soft px-3 py-2.5 text-[13.5px] text-ink">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green" />
            <span>{banner}</span>
          </div>
        )}

        {key === undefined ? (
          <div className="flex justify-center py-16 text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : !key ? (
          <Card className="p-4 text-[14px] text-ink-2">
            {phase.kind === "err" && <p className="mb-3 text-red">{phase.text}</p>}
            <p>
              This page needs your personal capture link. On your computer, open Coverage → Follow-ups → Reminders → <b>Info sessions</b> and use <b>Phone capture link</b> (or
              tap the link in your WhatsApp reminder). After opening it once here, you can add this page to your home screen.
            </p>
          </Card>
        ) : (
          <Card className="space-y-4 p-4">
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Info session</span>
              {sessions === null ? (
                <div className="flex items-center gap-2 text-[13px] text-muted">
                  <Loader2 className="size-3.5 animate-spin" /> Loading your calendar…
                </div>
              ) : (
                <Select className="w-full text-[15px]" value={sessionId} onChange={(e) => setSessionId(e.target.value)} disabled={busy}>
                  {sessions.map((s) => (
                    <option key={s.eventId} value={s.eventId}>
                      {label(s)}
                    </option>
                  ))}
                  <option value="">Other / not listed</option>
                </Select>
              )}
              {sessions !== null && !calendar && (
                <span className="mt-1 block text-[12px] text-muted">Your calendar isn&apos;t connected, so pick the session later in the dashboard.</span>
              )}
            </label>

            <div className="grid grid-cols-2 gap-2">
              <Button className="h-12! text-[14px]!" onClick={() => camera.current?.click()} disabled={busy}>
                <Camera className="size-4" /> Take photo
              </Button>
              <Button className="h-12! text-[14px]!" onClick={() => shots.current?.click()} disabled={busy}>
                <Images className="size-4" /> Choose screenshots
              </Button>
              <input
                ref={camera}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={shots}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {files.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                <span>
                  {files.length} image{files.length > 1 ? "s" : ""} ready
                </span>
                <button className="text-muted underline" onClick={() => setFiles([])} disabled={busy}>
                  Clear
                </button>
              </div>
            )}

            <label className="block">
              <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Names / notes</span>
              <Textarea
                className="min-h-[120px] w-full text-[15px]"
                placeholder={"Jane Doe – 2nd-year analyst, TMT, went to UCLA\nJohn Smith (VP)"}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
              />
            </label>

            <Button variant="primary" className="h-12! w-full text-[15px]!" onClick={send} disabled={busy || (!files.length && !text.trim())}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Sending {phase.done + 1 > phase.total ? phase.total : phase.done + 1} of {phase.total}…
                </>
              ) : (
                "Send to Coverage"
              )}
            </Button>

            {phase.kind === "ok" && (
              <div role="status" className="flex items-start gap-2 rounded-md bg-green-soft px-3 py-2.5 text-[13.5px] text-ink">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green" />
                <span>{phase.text}</span>
              </div>
            )}
            {phase.kind === "err" && (
              <div role="alert" className="flex items-start gap-2 rounded-md bg-red-soft px-3 py-2.5 text-[13.5px] text-ink">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red" />
                <span>{phase.text}</span>
              </div>
            )}
          </Card>
        )}
        <p className="mt-6 text-[11.5px] text-muted">
          Photos and notes wait on Coverage&apos;s server for up to 14 days until your dashboard picks them up, then they&apos;re deleted.{" "}
          <a href="/privacy" className="underline">
            Privacy
          </a>
        </p>
      </div>
    </div>
  );
}
