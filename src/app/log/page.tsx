"use client";

import { Fragment, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Coffee, ExternalLink, GraduationCap, NotebookPen, Plus, ShieldCheck, Sparkles, Trash2, UserPlus } from "lucide-react";
import { useStore } from "@/lib/store";
import { applyPatches, parseSnapshots } from "@/lib/workbook";
import { KIND_LABEL, KINDS, kindOf, type ConversationRow } from "@/lib/conversations";
import { linkOrphan, logConversation, notesForGrading, removeConversation, requestGrade, updateConversation } from "@/lib/conversationActions";
import { addManualContact } from "@/lib/actions";
import { aiReady } from "@/lib/keys";
import { detectRegion } from "@/lib/region";
import { cn } from "@/lib/util";
import type { ChatLog, Contact, ConversationKind } from "@/lib/types";
import { Badge, Button, Card, Empty, Field, Input, Kpi, Menu, Modal, PageHeader, Segmented, Select, Textarea, toast } from "@/components/ui";
import { Disagree, GradingRulesEditor } from "@/components/GradingRules";
import { RubricEditor } from "@/components/RubricEditor";

type Row = { c: Contact; chat: ChatLog };
type Filter = "all" | ConversationKind;
const MIN_GRADE = 200;

const KIND_TONE: Record<ConversationKind, "brass" | "blue" | "green" | "amber" | "neutral"> = {
  coffee_chat: "brass",
  call: "blue",
  info_session: "green",
  email: "neutral",
  in_person: "amber",
  other: "neutral",
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const gradeTone = (score: number) => (score >= 85 ? "green" : score >= 70 ? "blue" : "amber");

export default function LogPage() {
  return (
    <Suspense>
      <LogInner />
    </Suspense>
  );
}

type LogStart = { contactId?: string; orphan?: ConversationRow; kind?: ConversationKind; date?: string };

/** `?log=<contactId>&kind=coffee_chat&date=YYYY-MM-DD` (the Calendar page and the evening text) opens the log form for them. */
function startFromParams(p: URLSearchParams): LogStart | null {
  const id = p.get("log");
  if (!id) return null;
  const kind = p.get("kind") as ConversationKind | null;
  const date = p.get("date");
  return { contactId: id, kind: kind && (KINDS as string[]).includes(kind) ? kind : undefined, date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined };
}

function LogInner() {
  const params = useSearchParams();
  const contacts = useStore((s) => s.contacts);
  const snapshots = useStore((s) => s.snapshots);
  const patches = useStore((s) => s.patches);
  const settings = useStore((s) => s.settings);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [logging, setLogging] = useState<LogStart | null>(() => startFromParams(params));
  const deep = params.toString();
  const [prevDeep, setPrevDeep] = useState(deep);
  if (deep !== prevDeep) {
    setPrevDeep(deep);
    const next = startFromParams(params);
    if (next) setLogging(next);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rubricOpen, setRubricOpen] = useState(false);
  const [now] = useState(() => Date.now());
  const router = useRouter();

  const rows = useMemo<Row[]>(
    () => contacts.flatMap((c) => (c.chats ?? []).map((chat) => ({ c, chat }))).sort((a, b) => b.chat.at.localeCompare(a.chat.at)),
    [contacts],
  );
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      ({ c, chat }) => (filter === "all" || kindOf(chat) === filter) && (!term || `${c.name} ${c.bank} ${chat.notes ?? ""}`.toLowerCase().includes(term)),
    );
  }, [rows, filter, q]);

  // Conversation-table rows in the spreadsheet that match nobody (typed by hand): ask who they are.
  const sheetOrphans = useMemo(() => (snapshots.length ? (parseSnapshots(applyPatches(snapshots, patches)).orphans ?? []) : []), [snapshots, patches]);
  const orphans = useMemo(
    () => sheetOrphans.filter((o) => !contacts.some((c) => c.convRef?.sheet === o.sheet && c.convRef.row === o.row)),
    [sheetOrphans, contacts],
  );

  const stats = useMemo(() => {
    const weekAgo = now - 7 * 86_400_000;
    const talks = rows.filter((r) => !["email", "other"].includes(kindOf(r.chat)));
    const graded = rows.filter((r) => r.chat.grade);
    return {
      week: rows.filter((r) => new Date(r.chat.at).getTime() >= weekAgo).length,
      talks: talks.length,
      people: new Set(talks.map((r) => r.c.id)).size,
      avg: graded.length ? Math.round(graded.reduce((n, r) => n + r.chat.grade!.score, 0) / graded.length) : undefined,
      graded: graded.length,
      promised: rows.reduce((n, r) => n + (r.chat.grade?.commitments.length ?? 0), 0),
    };
  }, [rows, now]);

  const counts = useMemo(() => {
    const m = new Map<ConversationKind, number>();
    for (const r of rows) m.set(kindOf(r.chat), (m.get(kindOf(r.chat)) ?? 0) + 1);
    return m;
  }, [rows]);

  const grade = async ({ c, chat }: Row) => {
    const text = chat.transcript || (chat.notes ? notesForGrading(chat.notes) : "");
    if (text.length < MIN_GRADE) return toast.err("Add a few more lines of notes (about 200 characters) so there's something to grade.");
    setBusy(chat.id);
    try {
      const g = await requestGrade(c, text, chat.transcript ? chat.notes : undefined, chat.feel);
      updateConversation(c.id, chat.id, { grade: g });
      setOpen(chat.id);
      toast.ok(`Graded: ${g.score}/100 (${g.letter}).`);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Activity log"
        sub="Conversations, calls and emails you log by hand. Each one lands on the person and in their bank tab's Conversation table."
        right={
          <>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setLogging({})}>
              Log activity
            </Button>
            <Menu
              items={[
                { label: "Grading rules", hint: "What the AI grader should believe", icon: <GraduationCap />, onClick: () => setRulesOpen(true) },
                settings.admin && { label: "Grading rubric", hint: "Admin: areas, weights, what a 5 / 3 / 1 means", icon: <ShieldCheck />, onClick: () => setRubricOpen(true) },
              ]}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="This week" value={stats.week} sub={`${rows.length} logged in total`} />
        <Kpi label="Conversations" value={stats.talks} sub={`with ${stats.people} ${stats.people === 1 ? "person" : "people"}`} />
        <Kpi label="Average grade" value={stats.avg ?? "–"} ring={stats.avg !== undefined ? stats.avg / 100 : undefined} sub={stats.graded ? `${stats.graded} graded` : "Grade one from its notes"} />
        <Kpi label="Promised to you" value={stats.promised} sub="intros, referrals, reviews" tone={stats.promised ? "good" : undefined} />
      </div>

      {orphans.length > 0 && <Orphans list={orphans} contacts={contacts} onNewPerson={(orphan) => setLogging({ orphan })} />}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              ["all", "All"],
              ...KINDS.filter((k) => counts.get(k)).map(
                (k) =>
                  [
                    k,
                    <span key={k}>
                      {KIND_LABEL[k]} <span className="num text-muted">{counts.get(k)}</span>
                    </span>,
                  ] as const,
              ),
            ]}
          />
          <label className="ml-auto flex h-8 w-full items-center gap-2 rounded-lg border border-line-2 bg-panel px-2.5 text-[13px] sm:w-60">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by person, bank, notes…" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" aria-label="Filter" />
          </label>
        </div>
        {shown.length === 0 ? (
          <Empty icon={<NotebookPen className="size-6" />} title={rows.length ? "Nothing matches" : "Nothing logged yet"}>
            {rows.length ? "Try another filter." : "Log a coffee chat, a call or an email. It shows up on the person, the 9 PM text and your spreadsheet."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-subtle text-left text-[11px] tracking-[0.06em] text-muted uppercase">
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Person</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Notes</th>
                  <th className="px-3 py-2.5 font-medium">Grade</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const { c, chat } = r;
                  const isOpen = open === chat.id;
                  const k = kindOf(chat);
                  return (
                    <Fragment key={chat.id}>
                      <tr onClick={() => setOpen(isOpen ? null : chat.id)} className={cn("group cursor-pointer border-b border-line", isOpen ? "bg-brass-soft/40" : "hover:bg-subtle")}>
                        <td className="px-4 py-2.5 whitespace-nowrap text-ink">{chat.source === "spreadsheet" && chat.at.startsWith("1970") ? <span className="text-muted">No date</span> : fmt(chat.at)}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-ink">{c.name}</div>
                          <div className="text-[12px] text-muted">{[c.position, c.bank].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={KIND_TONE[k]}>{KIND_LABEL[k]}</Badge>
                        </td>
                        <td className="max-w-[340px] px-3 py-2.5">
                          <div className="truncate text-ink-2">{chat.notes || (chat.transcript ? "Transcript saved" : <span className="text-muted">–</span>)}</div>
                          {chat.source === "spreadsheet" && <div className="text-[11.5px] text-muted">Typed into the spreadsheet</div>}
                        </td>
                        <td className="px-3 py-2.5">
                          {chat.grade ? <Badge tone={gradeTone(chat.grade.score)}>{chat.grade.letter} · {chat.grade.score}</Badge> : <span className="text-muted">–</span>}
                        </td>
                        <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <Menu
                              items={[
                                aiReady(settings) && { label: busy === chat.id ? "Grading…" : chat.grade ? "Regrade with AI" : "Grade with AI", hint: "From the notes or transcript", icon: <Sparkles />, onClick: () => grade(r), disabled: !!busy },
                                { label: "Coffee chat prep", icon: <Coffee />, onClick: () => router.push(`/prep?id=${encodeURIComponent(c.id)}`) },
                                !!chat.docUrl && { label: "Open notes doc", icon: <ExternalLink />, onClick: () => window.open(chat.docUrl, "_blank", "noreferrer") },
                                chat.source !== "spreadsheet" && "divider",
                                chat.source !== "spreadsheet" && {
                                  label: "Delete",
                                  icon: <Trash2 />,
                                  danger: true,
                                  onClick: () => window.confirm(`Delete this ${KIND_LABEL[k].toLowerCase()} with ${c.name}?`) && removeConversation(c.id, chat.id),
                                },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-line bg-subtle">
                          <td colSpan={6} className="px-4 py-4">
                            <Details row={r} busy={busy === chat.id} onGrade={() => grade(r)} canGrade={aiReady(settings)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {rulesOpen && (
        <Modal open onClose={() => setRulesOpen(false)} title="Grading rules">
          <GradingRulesEditor />
        </Modal>
      )}

      {rubricOpen && settings.admin && (
        <Modal open wide onClose={() => setRubricOpen(false)} title="Grading rubric (admin)">
          <RubricEditor onDone={() => setRubricOpen(false)} />
        </Modal>
      )}

      {logging && (
        <LogModal
          key={`${logging.contactId ?? ""}:${logging.date ?? ""}`}
          start={logging}
          onClose={() => {
            setLogging(null);
            if (params.get("log")) router.replace("/log");
          }}
        />
      )}
    </div>
  );
}

function Details({ row: { c, chat }, busy, onGrade, canGrade }: { row: Row; busy: boolean; onGrade: () => void; canGrade: boolean }) {
  const g = chat.grade;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 text-[13px] lg:grid-cols-2">
      <div className="min-w-0">
        <div className="mb-1 text-[12px] text-muted">Notes</div>
        <p className="whitespace-pre-wrap text-ink-2">{chat.notes || "No notes."}</p>
        <label className="mt-2 block">
          <span className="text-[12px] text-muted">How it felt</span>
          <Input
            key={chat.id}
            className="mt-0.5 h-8 text-[12.5px]"
            defaultValue={chat.feel ?? ""}
            placeholder="e.g. he was laughing throughout (used when it's graded)"
            onBlur={(e) => {
              const v = e.target.value.trim() || undefined;
              if (v !== chat.feel) updateConversation(c.id, chat.id, { feel: v });
            }}
          />
        </label>
        {chat.docUrl && (
          <a href={chat.docUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-navy hover:underline">
            <ExternalLink className="size-3.5" /> Notes doc
          </a>
        )}
        <div className="mt-3">
          <Link href={`/prep?id=${encodeURIComponent(c.id)}`} className="text-[12.5px] text-navy hover:underline">
            Open {c.firstName || c.name} in coffee chat prep →
          </Link>
        </div>
      </div>
      <div className="min-w-0">
        {g ? (
          <>
            <div className="mb-1 text-[12px] text-muted">
              Grade · {g.letter} ({g.score}/100)
            </div>
            <p className="text-ink-2">{g.summary}</p>
            {g.toneRead && <p className="mt-1 text-[12.5px] text-muted">How it felt: {g.toneRead}</p>}
            {g.commitments.length > 0 && (
              <div className="mt-2">
                <div className="text-[12px] text-muted">They said they&apos;d</div>
                <ul className="mt-0.5 list-disc pl-5 text-ink-2">
                  {g.commitments.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {g.improvements.length > 0 && (
              <div className="mt-2">
                <div className="text-[12px] text-muted">Next time</div>
                <ul className="mt-0.5 list-disc pl-5 text-ink-2">
                  {g.improvements.slice(0, 3).map((x) => (
                    <li key={x.issue}>
                      {x.suggestion} <Disagree about={`${x.issue} → ${x.suggestion}`} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!g.theirAdvice?.length && (
              <div className="mt-2">
                <div className="text-[12px] text-muted">Their advice to you</div>
                <ul className="mt-0.5 list-disc pl-5 text-ink-2">
                  {g.theirAdvice.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {canGrade && (
              <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5" />} loading={busy} onClick={onGrade} className="mt-2">
                Regrade
              </Button>
            )}
          </>
        ) : (
          <div className="text-muted">
            Not graded.{" "}
            {canGrade && (
              <Button size="sm" variant="brass" icon={<Sparkles className="size-3.5" />} loading={busy} onClick={onGrade} className="ml-1">
                Grade with AI
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Spreadsheet Conversation rows nobody matches: link each to a person, or add them as a new contact. */
function Orphans({ list, contacts, onNewPerson }: { list: ConversationRow[]; contacts: Contact[]; onNewPerson: (o: ConversationRow) => void }) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const key = (o: ConversationRow) => `${o.sheet}:${o.row}`;
  return (
    <Card>
      <div className="border-b border-line px-5 py-3">
        <h3 className="text-[14.5px] font-medium text-ink">Who are these? ({list.length})</h3>
        <p className="mt-0.5 text-[12.5px] text-muted">Rows in your Conversation tables that don&apos;t match anyone in Contact Information. Link each one so a person is never listed twice.</p>
      </div>
      <ul className="divide-y divide-line">
        {list.map((o) => {
          const sameBank = contacts.filter((c) => c.bank.toLowerCase().includes(o.bank.toLowerCase().split(" ")[0]) || o.bank.toLowerCase().includes(c.bank.toLowerCase().split(" ")[0]));
          const options = (sameBank.length ? sameBank : contacts).slice().sort((a, b) => a.name.localeCompare(b.name));
          return (
            <li key={key(o)} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1 basis-[200px]">
                <div className="font-medium text-ink">{o.name}</div>
                <div className="text-[12px] text-muted">
                  {o.sheet} tab, row {o.row}
                  {o.email ? ` · ${o.email}` : ""}
                </div>
              </div>
              <Select value={pick[key(o)] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [key(o)]: e.target.value }))} className="h-8 max-w-[240px]" aria-label="Who is it">
                <option value="">Same person as…</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.bank}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="primary"
                disabled={!pick[key(o)]}
                onClick={() => {
                  try {
                    linkOrphan(o, pick[key(o)]);
                    toast.ok("Linked. Their details go into that row when you save.");
                  } catch (e) {
                    toast.err((e as Error).message);
                  }
                }}
              >
                Link
              </Button>
              <Button size="sm" variant="ghost" icon={<UserPlus className="size-3.5" />} onClick={() => onNewPerson(o)}>
                New person
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "Log activity": pick the person (or add one), what happened, notes, the doc link, and optionally grade it. */
function LogModal({ start, onClose }: { start: LogStart; onClose: () => void }) {
  const contacts = useStore((s) => s.contacts);
  const settings = useStore((s) => s.settings);
  const [who, setWho] = useState(() => {
    const c = contacts.find((x) => x.id === start.contactId);
    return c ? `${c.name} · ${c.bank}` : "";
  });
  const [isNew, setIsNew] = useState(!!start.orphan);
  const [name, setName] = useState(start.orphan?.name ?? "");
  const [bank, setBank] = useState(start.orphan?.bank ?? "");
  const [kind, setKind] = useState<ConversationKind>(start.kind ?? "coffee_chat");
  const [date, setDate] = useState(() => start.date ?? today());
  const [notes, setNotes] = useState(start.orphan ? start.orphan.notes : "");
  const [doc, setDoc] = useState("");
  const [feel, setFeel] = useState("");
  const [gradeIt, setGradeIt] = useState(true);
  const [busy, setBusy] = useState(false);
  const byLabel = useMemo(() => new Map(contacts.map((c) => [`${c.name} · ${c.bank}`, c])), [contacts]);
  const picked = byLabel.get(who.trim());
  const canGrade = aiReady(settings) && notes.trim().length >= MIN_GRADE;
  const error = isNew ? (!name.trim() ? "Their name?" : !bank.trim() ? "Which bank?" : "") : !picked ? "Pick someone from the list (or add a new person)." : "";
  const docError = doc.trim() && !/^https?:\/\//i.test(doc.trim()) ? "Paste the full link (https://…)." : "";

  const save = async () => {
    setBusy(true);
    try {
      let person = picked;
      if (isNew) {
        person = addManualContact(
          { name, bank, linkedin: "", email: start.orphan?.email ?? "", position: "", location: "", team: "", region: detectRegion(""), comment: "" },
          true,
        );
        if (start.orphan) linkOrphan(start.orphan, person.id);
      }
      if (!person) return;
      // Noon local, so the day never shifts across time zones.
      const at = new Date(`${date}T12:00:00`).toISOString();
      const { chat, row } = logConversation(person.id, { kind, at, notes, docUrl: doc, feel });
      const fresh = useStore.getState().contacts.find((x) => x.id === person!.id);
      toast.ok(
        row && fresh?.convRef
          ? `Logged. It goes into ${fresh.convRef.sheet}'s Conversation table (row ${fresh.convRef.row}) when you save the spreadsheet.`
          : useStore.getState().workbook
            ? `Logged. ${person.bank}'s Conversation table has no free row, so it's only in the dashboard for now.`
            : "Logged.",
      );
      onClose();
      if (gradeIt && canGrade) {
        try {
          const g = await requestGrade(fresh ?? person, notesForGrading(notes), undefined, feel);
          updateConversation(person.id, chat.id, { grade: g });
          toast.ok(`Graded: ${g.score}/100 (${g.letter}).`);
        } catch (e) {
          toast.err(`Logged, but grading failed: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Log activity">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
        {isNew ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoFocus />
            </Field>
            <Field label="Bank">
              <Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Evercore" />
            </Field>
          </div>
        ) : (
          <Field label="Who" hint={picked ? `${picked.position || "No title"} · ${picked.email || "no email"}` : "Start typing a name"}>
            <Input list="log-people" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Name · Bank" autoFocus />
            <datalist id="log-people">
              {contacts.map((c) => (
                <option key={c.id} value={`${c.name} · ${c.bank}`} />
              ))}
            </datalist>
          </Field>
        )}
        <button type="button" onClick={() => setIsNew((v) => !v)} className="-mt-1.5 justify-self-start text-[12.5px] text-navy hover:underline">
          {isNew ? "Pick someone already in your contacts" : "Someone new (adds them to Contact Information)"}
        </button>
        <Field label="What happened">
          <Segmented value={kind} onChange={setKind} options={KINDS.map((k) => [k, KIND_LABEL[k]] as const)} className="flex-wrap" />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[200px]" />
        </Field>
        <Field label="Notes" hint="What you talked about, what they offered, how it went. ~200+ characters can be graded.">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} />
        </Field>
        <Field label="How it felt" hint="Optional. Transcripts and notes lose tone, so the grader trusts this (laughing, ran long, flat).">
          <Input value={feel} onChange={(e) => setFeel(e.target.value.slice(0, 1000))} placeholder="e.g. he was laughing the whole time, ran 20 min over" />
        </Field>
        <Field label="Notes doc" hint="Optional: your Google Doc postmortem" error={docError}>
          <Input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="https://docs.google.com/document/d/…" />
        </Field>
        {aiReady(settings) && (
          <label className={cn("flex items-center gap-2 text-[13px]", canGrade ? "text-ink-2" : "text-muted")}>
            <input type="checkbox" checked={gradeIt && canGrade} disabled={!canGrade} onChange={(e) => setGradeIt(e.target.checked)} className="size-3.5 accent-brass-strong" />
            Grade it with AI {!canGrade && `(needs ${MIN_GRADE - notes.trim().length} more characters of notes)`}
          </label>
        )}
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        {error && (isNew ? name || bank : who) && <span className="mr-auto text-[12.5px] text-red">{error}</span>}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!!error || !!docError} loading={busy} onClick={save}>
          Log it
        </Button>
      </div>
    </Modal>
  );
}
