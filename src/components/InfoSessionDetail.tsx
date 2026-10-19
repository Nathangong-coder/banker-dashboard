"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Coffee, ImagePlus, MailPlus, Search, Send, Star, Trash2, UserPlus, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { emailVerified } from "@/lib/outreach";
import { cn, fmtDate } from "@/lib/util";
import type { Contact, InfoSession, SessionPerson } from "@/lib/types";
import { Badge, Button, Input, StatusBadge, Textarea, toast } from "@/components/ui";
import {
  addPending,
  confirmAll,
  confirmPerson,
  draftThankYous,
  extractPeople,
  findEmails,
  imageToDataUrl,
  peopleOf,
  serverOn,
  thankYouList,
  timingOf,
  unlinkPerson,
  type ThankYouResult,
  type ThankYouWhen,
} from "./InfoSessionActions";

const fmtTime = (d: Date) => d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function EmailState({ c }: { c: Contact }) {
  if (!c.email) return <Badge tone="amber">No email</Badge>;
  if (!emailVerified(c)) return <Badge tone="amber" className="max-w-full truncate">Unverified</Badge>;
  return <Badge tone="green">Email ✓</Badge>;
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
          <Star className={cn("size-4", value && value >= n ? "fill-current" : "opacity-40")} />
        </button>
      ))}
    </span>
  );
}

export function InfoSessionDetail({ session }: { session: InfoSession }) {
  const contacts = useStore((s) => s.contacts);
  const update = useStore((s) => s.updateInfoSession);
  const remove = useStore((s) => s.removeInfoSession);
  const people = useMemo(() => peopleOf(session, contacts), [session, contacts]);
  const [notes, setNotes] = useState(session.notes ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const past = new Date(session.start) <= new Date();
  const pending = session.pending ?? [];

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

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-line bg-[#faf9f5] px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
        <span className="flex items-center gap-1.5">
          <span className="text-muted">Went?</span>
          <Button size="sm" variant={session.attended === true ? "primary" : "secondary"} onClick={() => update(session.id, { attended: session.attended === true ? undefined : true })}>
            Yes
          </Button>
          <Button size="sm" variant={session.attended === false ? "primary" : "secondary"} onClick={() => update(session.id, { attended: session.attended === false ? undefined : false })}>
            No
          </Button>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted">Useful</span>
          <Stars value={session.rating} onChange={(rating) => update(session.id, { rating })} />
        </span>
        {session.source === "manual" && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-3.5" />}
            onClick={() => {
              remove(session.id);
              toast.ok("Session removed. The people you met there stay in your contacts.");
            }}
          >
            Remove session
          </Button>
        )}
      </div>

      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== (session.notes ?? "") && update(session.id, { notes })}
        rows={2}
        placeholder="Notes: what they said about recruiting, the culture, who to follow up with…"
        aria-label="Session notes"
      />

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[13px] font-semibold text-ink">People you met ({people.length})</h4>
          {people.some((c) => !c.email) && (
            <Button size="sm" icon={<Search className="size-3.5" />} loading={busy === "emails"} onClick={findEmailsNow}>
              Find emails ({people.filter((c) => !c.email).length})
            </Button>
          )}
        </div>
        {people.length === 0 ? (
          <p className="text-[12.5px] text-muted">Nobody yet. Add names below, upload a photo, or send captures from your phone.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line bg-panel">
            {people.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                <div className="min-w-0 flex-1 basis-[180px]">
                  <div className="truncate font-medium text-ink">{c.name}</div>
                  <div className="truncate text-[12px] text-muted">{[c.position, c.bank !== session.firm ? c.bank : ""].filter(Boolean).join(" · ") || "No title yet"}</div>
                </div>
                <EmailState c={c} />
                <StatusBadge status={c.status} />
                <Link href={`/prep?id=${encodeURIComponent(c.id)}`} className="inline-flex items-center gap-1 text-[12.5px] text-navy hover:underline">
                  <Coffee className="size-3.5" /> Prep
                </Link>
                <button type="button" className="text-muted hover:text-red" aria-label={`Take ${c.name} off this session`} title="Take off this session (the contact stays)" onClick={() => unlinkPerson(session.id, c.id)}>
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[13px] font-semibold text-ink">To review ({pending.length})</h4>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                icon={<Check className="size-3.5" />}
                onClick={() => {
                  const r = confirmAll(session.id);
                  toast.ok(`${r.created} added to your contacts${r.linked ? `, ${r.linked} already there (linked)` : ""}.`);
                  if (r.errors.length) toast.err(r.errors.slice(0, 3).join(" · "));
                }}
              >
                Confirm all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`Dismiss all ${pending.length} people waiting for review?`)) update(session.id, { pending: [] });
                }}
              >
                Dismiss all
              </Button>
            </div>
          </div>
          <ul className="space-y-2">
            {pending.map((p, i) => (
              <PendingRow key={`${p.from}:${i}:${p.name}`} session={session} person={p} index={i} />
            ))}
          </ul>
        </section>
      )}

      <AddPeople session={session} />

      {past && <ThankYous session={session} people={people} />}
    </div>
  );
}

function PendingRow({ session, person: p, index }: { session: InfoSession; person: SessionPerson; index: number }) {
  const update = useStore((s) => s.updateInfoSession);
  const set = (patch: Partial<SessionPerson>) => update(session.id, (s) => ({ pending: (s.pending ?? []).map((x, i) => (i === index ? { ...x, ...patch } : x)) }));
  return (
    <li className="rounded-md border border-line bg-panel p-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name" aria-label="Name" />
        <Input value={p.title ?? ""} onChange={(e) => set({ title: e.target.value || undefined })} placeholder="Title (Analyst…)" aria-label="Title" />
        <Input value={p.firm ?? ""} onChange={(e) => set({ firm: e.target.value || undefined })} placeholder={session.firm} aria-label="Firm" />
        <Input value={p.email ?? ""} onChange={(e) => set({ email: e.target.value || undefined })} placeholder="Email (if you got it)" aria-label="Email" type="email" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input className="min-w-0 flex-1 basis-[220px]" value={p.note ?? ""} onChange={(e) => set({ note: e.target.value || undefined })} placeholder="Note: what you talked about (goes in the thank-you)" aria-label="Note" />
        <Button
          size="sm"
          variant="primary"
          icon={<Check className="size-3.5" />}
          onClick={() => {
            try {
              const r = confirmPerson(session.id, index);
              toast.ok(r.created ? `${r.contact.name} added to your contacts${r.contact.ref ? ` (${r.contact.ref.sheet} tab)` : ""}.` : `${r.contact.name} was already in your contacts: linked to this session.`);
            } catch (e) {
              toast.err((e as Error).message);
            }
          }}
        >
          Confirm
        </Button>
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => update(session.id, (s) => ({ pending: (s.pending ?? []).filter((_, i) => i !== index) }))}>
          Dismiss
        </Button>
      </div>
    </li>
  );
}

function AddPeople({ session }: { session: InfoSession }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"text" | "photo" | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const read = async (input: { text?: string; image?: string }, what: "text" | "photo") => {
    setBusy(what);
    try {
      const people = await extractPeople(input, session);
      const n = addPending(session.id, people, "manual");
      if (!people.length) toast.info("No names found in that.");
      else toast.ok(`${n} ${n === 1 ? "person" : "people"} to review${people.length > n ? ` (${people.length - n} already here)` : ""}.`);
      if (what === "text") setText("");
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-md border border-dashed border-line-2 bg-panel p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <UserPlus className="size-4" /> Add people
      </h4>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={"One per line, e.g.\nJane Doe, Analyst, TMT, went to UCLA\nJohn Smith - Associate"}
        aria-label="Names to add"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={!text.trim()} loading={busy === "text"} onClick={() => read({ text }, "text")}>
          Read names
        </Button>
        <Button size="sm" icon={<ImagePlus className="size-3.5" />} loading={busy === "photo"} onClick={() => file.current?.click()}>
          Upload photo / screenshot
        </Button>
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
              const image = await imageToDataUrl(f);
              await read({ image }, "photo");
            } catch (err) {
              toast.err((err as Error).message);
            }
          }}
        />
        <span className="text-[12px] text-muted">Name tags, a sign-in sheet or a Zoom participant list. You review everyone before they become contacts.</span>
      </div>
    </section>
  );
}

function ThankYous({ session, people }: { session: InfoSession; people: Contact[] }) {
  const settings = useStore((s) => s.settings);
  const contacts = useStore((s) => s.contacts);
  const [busy, setBusy] = useState<ThankYouWhen | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const todo = useMemo(() => thankYouList(session, contacts), [session, contacts]);
  const ready = todo.filter((c) => emailVerified(c));
  const auto = serverOn({ settings }) && settings.sendMode !== "gmail";
  const timing = timingOf(session);
  const queued = people.filter((c) => c.serverSend && c.serverSend.step === 0);
  const sent = people.filter((c) => c.sentAt);

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

  const label = (when: ThankYouWhen) => (busy === when && progress ? `Drafting ${progress}` : when === "tonight" ? (auto ? "Send tonight" : "Draft thank-yous in Gmail") : "Next week");

  return (
    <section className="rounded-md border border-line bg-panel p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-[240px]">
          <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <MailPlus className="size-4" /> Thank-yous
          </h4>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {ready.length} ready{todo.length > ready.length ? `, ${todo.length - ready.length} need a verified email first` : ""}
            {queued.length ? ` · ${queued.length} queued` : ""}
            {sent.length ? ` · ${sent.length} sent` : ""}
            {timing === "choose" && " · Friday / weekend session: send tonight or next week"}
            {session.followUp && ` · you chose ${session.followUp.when === "tonight" ? "tonight" : "next week"} (${fmtDate(session.followUp.decidedAt)})`}
          </p>
          {!auto && (
            <p className="mt-1 text-[12px] text-muted">
              Automatic sending is off{settings.server?.email ? " (Gmail Schedule send mode)" : ""}, so drafts wait in Gmail.{" "}
              {!settings.server?.email && (
                <Link href="/followups?tab=reminders" className="text-navy hover:underline">
                  Turn it on
                </Link>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {timing === "tonight" || !auto ? (
            <Button size="sm" variant="brass" icon={<Send className="size-3.5" />} disabled={!ready.length || !!busy} loading={busy === "tonight"} onClick={() => run("tonight")}>
              {label("tonight")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant={session.followUp?.when === "next_week" ? "secondary" : "brass"} icon={<Send className="size-3.5" />} disabled={!ready.length || !!busy} loading={busy === "tonight"} onClick={() => run("tonight")}>
                {label("tonight")}
              </Button>
              <Button size="sm" variant={session.followUp?.when === "next_week" ? "brass" : "secondary"} disabled={!ready.length || !!busy} loading={busy === "next_week"} onClick={() => run("next_week")}>
                {label("next_week")}
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
