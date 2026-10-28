"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown, ClipboardPaste, Coffee, ExternalLink, ImagePlus, List, MapPin, MessageSquareText, Search, Send, Star, Trash2, UserPlus, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { emailVerified } from "@/lib/outreach";
import { cn, fmtDate } from "@/lib/util";
import type { Contact, InfoSession, SessionPerson } from "@/lib/types";
import { Badge, Button, Input, Menu, Segmented, Textarea, toast } from "@/components/ui";
import { enrichContacts } from "@/lib/actions";
import {
  addFromLinkedIn,
  addPending,
  addPersonNow,
  appendSessionNotes,
  confirmPerson,
  draftThankYous,
  extractPeople,
  findEmails,
  imageToDataUrl,
  noteFor,
  peopleOf,
  readLinkedIn,
  serverOn,
  setNoteFor,
  thankYouList,
  timingOf,
  unlinkPerson,
  type ThankYouResult,
  type ThankYouWhen,
} from "./InfoSessionActions";

const fmtTime = (d: Date) => d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** A stable color per firm for its badge (hue from the name; dark enough for white text in every theme). */
export function FirmMark({ firm, size = 32 }: { firm: string; size?: number }) {
  let h = 0;
  for (const ch of firm.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-lg font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `hsl(${h} 42% 36%)` }}
    >
      {initials(firm) || "?"}
    </span>
  );
}

export function sessionWhen(s: InfoSession) {
  const start = new Date(s.start);
  const day = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (s.allDay) return { day, time: "Time TBD" };
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return { day, time: `${t(start)} – ${t(new Date(s.end))}` };
}

function EmailLine({ c }: { c: Contact }) {
  if (!c.email) return <span className="text-amber">no email yet</span>;
  if (!emailVerified(c)) return <span className="text-amber">{c.email} (unverified)</span>;
  return <span>{c.email}</span>;
}

function Stars({ value, onChange }: { value?: number; onChange: (v: number | undefined) => void }) {
  return (
    <span className="inline-flex items-center" role="group" aria-label="How useful was it">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} of 5`}
          aria-pressed={!!value && value >= n}
          onClick={() => onChange(value === n ? undefined : n)}
          className="p-0.5 text-brass hover:scale-110"
        >
          <Star className={cn("size-4", value && value >= n ? "fill-current" : "opacity-35")} />
        </button>
      ))}
    </span>
  );
}

type Tab = "people" | "review" | "notes";

/**
 * One session, as a side panel (app/info-sessions): who you met, names from your phone to review, notes, and the
 * thank-you action at the bottom. One primary button at a time; the rest is in the ⋯ menu.
 */
export function InfoSessionDetail({ session, onClose }: { session: InfoSession; onClose: () => void }) {
  const contacts = useStore((s) => s.contacts);
  const update = useStore((s) => s.updateInfoSession);
  const remove = useStore((s) => s.removeInfoSession);
  const people = useMemo(() => peopleOf(session, contacts), [session, contacts]);
  const pending = session.pending ?? [];
  const past = new Date(session.start) <= new Date();
  const [tab, setTab] = useState<Tab>(pending.length ? "review" : "people");
  // Another session opened in the same panel: start on its review list if it has one.
  const [prevId, setPrevId] = useState(session.id);
  if (prevId !== session.id) {
    setPrevId(session.id);
    setTab(pending.length ? "review" : "people");
  }
  const [busy, setBusy] = useState<string | null>(null);
  const noEmail = people.filter((c) => !c.email).length;
  const { day, time } = sessionWhen(session);

  const findEmailsNow = async () => {
    setBusy("emails");
    try {
      const r = await findEmails(session);
      if (!r.attempted) toast.info("Everyone here already has an email, or needs a LinkedIn link / full name to search with.");
      else toast.ok(`Found ${r.found} of ${r.attempted} emails.${r.errors.length ? ` ${r.errors[0]}` : ""}`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const tabs: [Tab, ReactNode][] = [
    ["people", <Count key="p" label="People" n={people.length} />],
    ["review", <Count key="r" label="To review" n={pending.length} accent />],
    ["notes", "Notes"],
  ];

  return (
    <div className="flex max-h-full min-h-0 flex-col">
      <div className="border-b border-line px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <FirmMark firm={session.firm} size={36} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] leading-snug font-medium text-ink">{session.title.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() || session.firm}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
              <span>
                {day} · {time}
              </span>
              {session.link ? (
                <a href={session.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-navy hover:underline">
                  <ExternalLink className="size-3" /> Join link
                </a>
              ) : session.location ? (
                <span className="inline-flex min-w-0 items-center gap-1" title={session.location}>
                  <MapPin className="size-3 shrink-0" /> <span className="truncate">{session.location}</span>
                </span>
              ) : null}
            </div>
          </div>
          <Menu
            items={[
              noEmail > 0 && { label: `Find ${noEmail} email${noEmail === 1 ? "" : "s"}`, hint: "Apollo, then Hunter", icon: <Search />, onClick: findEmailsNow },
              pending.length > 0 && {
                label: `Dismiss all ${pending.length} to review`,
                icon: <X />,
                onClick: () => window.confirm(`Dismiss all ${pending.length} people waiting for review?`) && update(session.id, { pending: [] }),
              },
              session.source === "manual" && "divider",
              session.source === "manual" && {
                label: "Remove session",
                hint: "The people you met stay in your contacts",
                icon: <Trash2 />,
                danger: true,
                onClick: () => {
                  remove(session.id);
                  onClose();
                  toast.ok("Session removed. The people you met there stay in your contacts.");
                },
              },
            ]}
          />
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose} className="px-1.5">
            <X className="size-4" />
          </Button>
        </div>
        {past && (
          <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Segmented
              value={session.attended === true ? "went" : session.attended === false ? "skipped" : ("" as string)}
              onChange={(v) => {
                const next = v === "went";
                update(session.id, { attended: session.attended === next ? undefined : next });
              }}
              options={[
                ["went", "Went"],
                ["skipped", "Skipped"],
              ]}
            />
            <Stars value={session.rating} onChange={(rating) => update(session.id, { rating })} />
            {session.titleNote && <Badge tone="brass">{session.titleNote}</Badge>}
          </div>
        )}
      </div>

      <div role="tablist" className="flex gap-5 border-b border-line px-5">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("relative py-2.5 text-[13px] font-medium", tab === k ? "text-ink" : "text-muted hover:text-ink")}
          >
            {label}
            {tab === k && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded bg-brass" />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "people" && (
          <>
            {people.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-muted">
                {past ? "Nobody yet. Send names from your phone, or add them below." : "After it ends, send who you met from your phone (you'll get a text)."}
              </p>
            ) : (
              <ul>
                {people.map((c) => (
                  <PersonRow key={c.id} c={c} session={session} onUnlink={() => unlinkPerson(session.id, c.id)} />
                ))}
              </ul>
            )}
            {noEmail > 0 && (
              <div className="px-5 pt-3">
                <Button size="sm" variant="brass" icon={<Search className="size-3.5" />} loading={busy === "emails"} onClick={findEmailsNow}>
                  Find {noEmail} email{noEmail === 1 ? "" : "s"}
                </Button>
              </div>
            )}
            <AddPeople session={session} onAdded={() => setTab("review")} onNotes={() => setTab("notes")} />
          </>
        )}
        {tab === "review" && <Review session={session} />}
        {tab === "notes" && <Notes session={session} />}
      </div>

      {tab !== "review" && past && people.length > 0 && <ThankYous session={session} people={people} />}
      {!past && (
        <div className="border-t border-line bg-subtle px-5 py-3 text-[12.5px] text-muted">
          You&apos;ll get a text 1–2 hours before, and one when it ends to send who you met.
        </div>
      )}
    </div>
  );
}

function Count({ label, n, accent }: { label: string; n: number; accent?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {n > 0 && <span className={cn("num rounded-full px-1.5 text-[11px]", accent ? "bg-brass-soft text-brass-ink" : "bg-hover text-ink-2")}>{n}</span>}
    </span>
  );
}

/** Someone you met: click to write what they said (the thank-you brings it up, and it's kept in their Comment). */
function PersonRow({ c, session, onUnlink }: { c: Contact; session: InfoSession; onUnlink: () => void }) {
  const firm = session.firm;
  const sent = !!c.sentAt;
  const queued = !sent && !!c.serverSend;
  const note = noteFor(c, session);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note);
  const save = () => draft.trim() !== note && setNoteFor(session.id, c.id, draft);
  return (
    <li className="border-b border-line">
      <div className="group flex items-center gap-3 px-5 py-2.5 hover:bg-subtle">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-chart-soft text-[11.5px] font-medium text-ink-2">{initials(c.name)}</span>
        <button
          type="button"
          onClick={() => {
            if (open) save();
            else setDraft(note);
            setOpen(!open);
          }}
          className="min-w-0 flex-1 text-left"
          title="What they said"
        >
          <div className="truncate text-[13.5px] font-medium text-ink">{c.name}</div>
          <div className="truncate text-[12px] text-muted">
            {[c.position, c.bank !== firm ? c.bank : ""].filter(Boolean).join(" · ")}
            {c.position || c.bank !== firm ? " · " : ""}
            <EmailLine c={c} />
          </div>
          {!open && (
            <div className={cn("mt-0.5 truncate text-[12px]", note ? "text-ink-2" : "text-muted/80 italic")}>
              <MessageSquareText className="mr-1 inline size-3 align-[-2px]" />
              {note || "Add what they said"}
            </div>
          )}
        </button>
        <span className="shrink-0 group-hover:hidden">
          {c.repliedAt ? <Badge tone="green">Replied</Badge> : sent ? <Badge tone="blue">Thanked</Badge> : queued ? <Badge tone="blue">Queued</Badge> : c.email && emailVerified(c) ? <Badge tone="green">Ready</Badge> : null}
        </span>
        <span className="hidden shrink-0 items-center gap-1 group-hover:flex">
          <Link href={`/prep?id=${encodeURIComponent(c.id)}`} title="Coffee chat prep" className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink">
            <Coffee className="size-3.5" />
          </Link>
          <button type="button" title="Take off this session (the contact stays)" aria-label={`Take ${c.name} off this session`} onClick={onUnlink} className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-red">
            <X className="size-3.5" />
          </button>
        </span>
      </div>
      {open && (
        <div className="bg-subtle px-5 pb-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            rows={3}
            autoFocus
            placeholder="What they said that you'd bring up: their take on TMT, how they got into banking, advice they gave…"
            aria-label={`What ${c.name} said`}
          />
          <p className="mt-1 text-[11.5px] text-muted">
            {sent ? "Kept in their Comment for your follow-ups." : "The thank-you mentions this (\"I especially liked your perspective on…\"). Saved in their Comment."}
          </p>
        </div>
      )}
    </li>
  );
}

/** Names read from captures: tick who's real, fix a typo if needed, and add them to the tracker in one go. */
function Review({ session }: { session: InfoSession }) {
  const update = useStore((s) => s.updateInfoSession);
  const pending = session.pending ?? [];
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const picked = pending.map((_, i) => i).filter((i) => !skip.has(i));

  const confirm = () => {
    let created = 0;
    let linked = 0;
    const errors: string[] = [];
    // Highest index first: confirming removes the row, which shifts the ones after it.
    for (const i of [...picked].sort((a, b) => b - a)) {
      try {
        const r = confirmPerson(session.id, i);
        if (r.created) created++;
        else linked++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    setSkip(new Set());
    setEditing(null);
    if (created || linked) toast.ok(`${created} added to your tracker${linked ? `, ${linked} already there (linked)` : ""}.`);
    if (errors.length) toast.err(errors.slice(0, 3).join(" · "));
  };

  if (!pending.length)
    return (
      <>
        <p className="px-5 py-6 text-[13px] text-muted">Nothing to review. Names you send from your phone (or add here) show up here first.</p>
        <AddPeople session={session} />
      </>
    );
  return (
    <div className="flex min-h-full flex-col">
      <ul>
        {pending.map((p, i) => {
          const on = !skip.has(i);
          return (
            <li key={`${p.from}:${i}:${p.name}`} className="border-b border-line">
              <div className="group flex items-center gap-3 px-5 py-2.5 hover:bg-subtle">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`Add ${p.name}`}
                  onClick={() => setSkip((s) => (on ? new Set(s).add(i) : new Set([...s].filter((x) => x !== i))))}
                  className={cn("grid size-[18px] shrink-0 place-items-center rounded-[5px] border", on ? "border-brass-strong bg-brass-strong text-white" : "border-line-2 bg-panel")}
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </button>
                <button type="button" onClick={() => setEditing(editing === i ? null : i)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[13.5px] font-medium text-ink">{p.name}</div>
                  <div className="truncate text-[12px] text-muted">
                    {[p.title, p.firm && p.firm !== session.firm ? p.firm : "", p.email, p.note].filter(Boolean).join(" · ") || (p.from === "manual" ? "Added here" : "From your phone")}
                  </div>
                </button>
                <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", editing === i && "rotate-180")} />
                <button
                  type="button"
                  title="Dismiss"
                  aria-label={`Dismiss ${p.name}`}
                  onClick={() => {
                    update(session.id, (s) => ({ pending: (s.pending ?? []).filter((_, j) => j !== i) }));
                    setSkip(new Set());
                    setEditing(null);
                  }}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-red"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              {editing === i && <PendingEditor session={session} person={p} index={i} />}
            </li>
          );
        })}
      </ul>
      <AddPeople session={session} />
      <div className="sticky bottom-0 mt-auto flex items-center gap-3 border-t border-line bg-subtle px-5 py-3">
        <Button variant="primary" icon={<Check className="size-4" />} disabled={!picked.length} onClick={confirm}>
          Add {picked.length} to tracker
        </Button>
        {skip.size > 0 && <span className="text-[12.5px] text-muted">{skip.size} unticked</span>}
      </div>
    </div>
  );
}

function PendingEditor({ session, person: p, index }: { session: InfoSession; person: SessionPerson; index: number }) {
  const update = useStore((s) => s.updateInfoSession);
  const set = (patch: Partial<SessionPerson>) => update(session.id, (s) => ({ pending: (s.pending ?? []).map((x, i) => (i === index ? { ...x, ...patch } : x)) }));
  return (
    <div className="grid grid-cols-2 gap-2 bg-subtle px-5 pb-3">
      <Input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name" aria-label="Name" />
      <Input value={p.title ?? ""} onChange={(e) => set({ title: e.target.value || undefined })} placeholder="Title (Analyst…)" aria-label="Title" />
      <Input value={p.firm ?? ""} onChange={(e) => set({ firm: e.target.value || undefined })} placeholder={session.firm} aria-label="Firm" />
      <Input value={p.email ?? ""} onChange={(e) => set({ email: e.target.value || undefined })} placeholder="Email (if you got it)" aria-label="Email" type="email" />
      <Input className="col-span-2" value={p.note ?? ""} onChange={(e) => set({ note: e.target.value || undefined })} placeholder="What you talked about (goes in the thank-you)" aria-label="Note" />
    </div>
  );
}

/** "Add person / Paste LinkedIn / Paste a list / Upload a photo": collapsed to one row of buttons until used. */
function AddPeople({ session, onAdded, onNotes }: { session: InfoSession; onAdded?: () => void; onNotes?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"text" | "photo" | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const read = async (input: { text?: string; image?: string }, what: "text" | "photo") => {
    setBusy(what);
    try {
      const { people, notes } = await extractPeople(input, session);
      const n = addPending(session.id, people, "manual");
      // Lines that weren't about one person (what was said, tips) are kept as the session's notes, not dropped.
      const noted = appendSessionNotes(session.id, notes);
      if (people.length) toast.ok(`${n} ${n === 1 ? "person" : "people"} to review${people.length > n ? ` (${people.length - n} already here)` : ""}${noted ? ". The rest went to Notes" : ""}.`);
      else if (noted) toast.ok("No names in that, so it was saved to the session's Notes.");
      else toast.info("No names found in that.");
      if (people.length) onAdded?.();
      else if (noted) onNotes?.();
      if (what === "text") {
        setText("");
        setOpen(false);
      }
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const picker = (
    <input
      ref={file}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        try {
          await read({ image: await imageToDataUrl(f) }, "photo");
        } catch (err) {
          toast.err((err as Error).message);
        }
      }}
    />
  );

  if (adding) return <AddPersonForm session={session} onDone={() => setAdding(false)} />;
  if (pasting) return <PasteLinkedIn session={session} onDone={() => setPasting(false)} />;
  if (!open)
    return (
      <div className="flex flex-wrap gap-1 px-3 py-2.5">
        <Button size="sm" variant="ghost" icon={<UserPlus className="size-3.5" />} onClick={() => setAdding(true)} title="Name, title, email, what they said: straight into your tracker">
          Add person
        </Button>
        <Button size="sm" variant="ghost" icon={<ClipboardPaste className="size-3.5" />} onClick={() => setPasting(true)} title="Copy their LinkedIn profile page and paste it: they go straight into your tracker">
          Paste LinkedIn
        </Button>
        <Button size="sm" variant="ghost" icon={<List className="size-3.5" />} onClick={() => setOpen(true)} title="Several people at once, one per line. Lines that aren't people go to Notes">
          Paste a list
        </Button>
        <Button size="sm" variant="ghost" icon={<ImagePlus className="size-3.5" />} loading={busy === "photo"} onClick={() => file.current?.click()} title="Name tags, a sign-in sheet or a Zoom participant list">
          Upload a photo
        </Button>
        {picker}
      </div>
    );
  return (
    <div className="px-5 py-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        autoFocus
        placeholder={"One per line, e.g.\nJane Doe, Analyst, TMT, went to UCLA\nJohn Smith - Associate\nLines that aren't a person (what was said) go to Notes"}
        aria-label="Names to add"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="brass" disabled={!text.trim()} loading={busy === "text"} onClick={() => read({ text }, "text")}>
          Read list
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {picker}
      </div>
    </div>
  );
}

/** One person by hand, every field yours: added straight to the tracker as met here, then their email is looked up. Stays open for the next. */
function AddPersonForm({ session, onDone }: { session: InfoSession; onDone: () => void }) {
  const empty = { name: "", title: "", firm: "", email: "", linkedin: "", note: "" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const email = f.email.trim();
  const link = f.linkedin.trim();
  const error =
    email && !/^\S+@\S+\.\S+$/.test(email) ? "That email doesn't look right." : link && !/linkedin\.com\/in\//i.test(link) ? "The LinkedIn link should look like linkedin.com/in/…" : "";

  const add = async () => {
    setBusy(true);
    try {
      const { contact, created } = addPersonNow(session.id, {
        name: f.name.trim().replace(/\s+/g, " "),
        title: f.title.trim() || undefined,
        firm: f.firm.trim() || undefined,
        email: email.toLowerCase() || undefined,
        linkedin: link || undefined,
        note: f.note.trim() || undefined,
      });
      setF(empty);
      setAdded((a) => [...a, contact.name]);
      toast.ok(`${created ? "Added" : "Linked"} ${contact.name}.`);
      if (!contact.email) {
        const r = await enrichContacts([contact.id]).catch((e: Error) => ({ found: 0, attempted: 1, errors: [e.message] }));
        if (r.found) toast.ok(`Found ${contact.name}'s email.`);
        else toast.info(`No email found for ${contact.name} yet${r.errors[0] ? `: ${r.errors[0]}` : ""}. Add it in the tracker if you have it.`);
      }
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-2 px-5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (f.name.trim() && !error && !busy) add();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Input value={f.name} onChange={set("name")} placeholder="Full name" aria-label="Name" autoFocus required />
        <Input value={f.title} onChange={set("title")} placeholder="Title (Analyst…)" aria-label="Title" />
        <Input value={f.firm} onChange={set("firm")} placeholder={session.firm} aria-label="Firm" title="Leave blank for the session's firm" />
        <Input value={f.email} onChange={set("email")} placeholder="Email (if you got it)" aria-label="Email" type="email" />
        <Input className="col-span-2" value={f.linkedin} onChange={set("linkedin")} placeholder="LinkedIn URL (optional, helps find their email)" aria-label="LinkedIn URL" />
      </div>
      <Textarea
        value={f.note}
        onChange={set("note")}
        rows={3}
        placeholder="What they said that you'd bring up in your email: their take on a deal, how they got into banking, advice…"
        aria-label="What they said"
      />
      {error && <p className="text-[12px] text-red">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="brass" disabled={!f.name.trim() || !!error} loading={busy}>
          Add to tracker
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {added.length ? "Done" : "Cancel"}
        </Button>
        {added.length > 0 && <span className="truncate text-[12px] text-muted">Added: {added.join(", ")}</span>}
      </div>
    </form>
  );
}

/**
 * Paste someone's LinkedIn page (Ctrl+A, Ctrl+C on their profile) plus what they talked about: they go straight into the
 * tracker as met here, their email is looked up, and the footer's thank-you button drafts the email. Stays open for the next.
 */
function PasteLinkedIn({ session, onDone }: { session: InfoSession; onDone: () => void }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  const add = async () => {
    setBusy(true);
    try {
      const person = await readLinkedIn(text, session);
      const link = url.trim() || text.match(/https?:\/\/[^\s]*linkedin\.com\/in\/[^\s,;)]+/i)?.[0] || person.linkedin;
      if (link && !/linkedin\.com\/in\//i.test(link)) throw new Error("That LinkedIn link should look like linkedin.com/in/…");
      const { contact, created } = addFromLinkedIn(session.id, { ...person, linkedin: link, note: note.trim() || undefined }, text);
      setText("");
      setNote("");
      setUrl("");
      setAdded((a) => [...a, contact.name]);
      const what = [contact.position, contact.location].filter(Boolean).join(" · ");
      toast.ok(`${created ? "Added" : "Linked"} ${contact.name}${what ? ` (${what})` : ""}.`);
      if (!contact.email) {
        const r = await enrichContacts([contact.id]).catch((e: Error) => ({ found: 0, attempted: 1, errors: [e.message] }));
        if (r.found) toast.ok(`Found ${contact.name}'s email.`);
        else toast.info(`No email found for ${contact.name} yet${r.errors[0] ? `: ${r.errors[0]}` : ""}. Add it in the tracker if you have it.`);
      }
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 px-5 py-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        autoFocus
        placeholder="On their LinkedIn profile press Ctrl+A, Ctrl+C, then paste here"
        aria-label="Their LinkedIn profile"
      />
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="I especially liked your perspective on… (optional)" aria-label="What you liked about what they said" />
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Their LinkedIn URL (optional, helps find their email)" aria-label="LinkedIn URL" />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="brass" disabled={!text.trim()} loading={busy} onClick={add}>
          Add to tracker
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {added.length ? "Done" : "Cancel"}
        </Button>
        {added.length > 0 && <span className="truncate text-[12px] text-muted">Added: {added.join(", ")}</span>}
      </div>
    </div>
  );
}

function Notes({ session }: { session: InfoSession }) {
  const update = useStore((s) => s.updateInfoSession);
  const [notes, setNotes] = useState(session.notes ?? "");
  return (
    <div className="px-5 py-4">
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== (session.notes ?? "") && update(session.id, { notes })}
        rows={8}
        placeholder="What they said about recruiting, the culture, who to follow up with…"
        aria-label="Session notes"
      />
      <p className="mt-1.5 text-[12px] text-muted">
        Saved when you click away. Something one person said goes on their row under People: that&apos;s what their thank-you brings up.
      </p>
    </div>
  );
}

/** The panel's footer: the one thank-you action (with "next week" in its menu for Friday / weekend sessions). */
function ThankYous({ session, people }: { session: InfoSession; people: Contact[] }) {
  const settings = useStore((s) => s.settings);
  const contacts = useStore((s) => s.contacts);
  const [busy, setBusy] = useState<ThankYouWhen | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const todo = useMemo(() => thankYouList(session, contacts), [session, contacts]);
  const ready = todo.filter((c) => emailVerified(c));
  const auto = serverOn({ settings }) && settings.sendMode !== "gmail";
  const choose = auto && timingOf(session) === "choose";
  const queued = people.filter((c) => c.serverSend && c.serverSend.step === 0).length;
  const sent = people.filter((c) => c.sentAt).length;

  const run = async (when: ThankYouWhen) => {
    setBusy(when);
    try {
      const r: ThankYouResult = await draftThankYous(session.id, when, (d, t) => setProgress(`${d}/${t}`));
      if (!r.drafted && !r.errors.length) toast.info(r.skipped.length ? `Nobody to thank yet: ${r.skipped.slice(0, 3).join(", ")}.` : "Nobody left to thank here.");
      else if (r.mode === "server")
        toast.ok(`${r.queued} thank-you${r.queued === 1 ? "" : "s"} queued${r.firstAt ? `, first at ${fmtTime(r.firstAt)}` : ""}. Drafts are in Gmail until then.`);
      else if (r.drafted) toast.ok(`${r.drafted} thank-you${r.drafted === 1 ? "" : "s"} drafted. Drafts are in Gmail: send or schedule them there.`);
      if (r.drafted && r.skipped.length) toast.info(`Skipped: ${r.skipped.slice(0, 4).join(", ")}${r.skipped.length > 4 ? "…" : ""}`);
      if (r.errors.length) toast.err(r.errors.slice(0, 3).join(" · "));
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const n = ready.length;
  const status = [
    sent && `${sent} thanked`,
    queued && `${queued} queued`,
    todo.length > n && `${todo.length - n} need a verified email`,
    session.followUp && `you chose ${session.followUp.when === "tonight" ? "tonight" : "next week"} (${fmtDate(session.followUp.decidedAt)})`,
  ].filter(Boolean);
  const nextWeekFirst = choose && session.followUp?.when === "next_week";

  return (
    <div className="border-t border-line bg-subtle px-5 py-3">
      {n > 0 ? (
        <div className="flex items-center gap-2">
          <Button variant="primary" icon={<Send className="size-4" />} disabled={!!busy} loading={busy === (nextWeekFirst ? "next_week" : "tonight")} onClick={() => run(nextWeekFirst ? "next_week" : "tonight")}>
            {busy && progress
              ? `Drafting ${progress}`
              : !auto
                ? `Draft ${n} thank-you${n === 1 ? "" : "s"} in Gmail`
                : nextWeekFirst
                  ? `Send ${n} next Monday`
                  : `Send ${n} thank-you${n === 1 ? "" : "s"} tonight`}
          </Button>
          {choose && (
            <Menu
              up
              align="left"
              label="Other timing"
              items={[
                nextWeekFirst
                  ? { label: "Send tonight instead", hint: "A few minutes apart, this evening", onClick: () => run("tonight") }
                  : { label: "Next week instead", hint: "Your first send day next week, in the usual window", onClick: () => run("next_week") },
              ]}
            />
          )}
        </div>
      ) : (
        <div className="text-[13px] text-ink-2">{sent || queued ? "Everyone here with an email is thanked or queued." : "No one to thank yet."}</div>
      )}
      {(status.length > 0 || !auto) && (
        <p className="mt-1.5 text-[12px] text-muted">
          {status.join(" · ")}
          {!auto && (
            <>
              {status.length ? " · " : ""}Automatic sending is off, so drafts wait in Gmail.{" "}
              {!settings.server?.email && (
                <Link href="/followups?tab=reminders" className="text-navy hover:underline">
                  Turn it on
                </Link>
              )}
            </>
          )}
          {choose && !session.followUp && `${status.length ? " · " : ""}Friday / weekend session: tonight or next week (⋯)`}
        </p>
      )}
    </div>
  );
}
