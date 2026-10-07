"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bookmark, Check, ClipboardCopy, Coffee, ExternalLink, Pencil, Printer, RefreshCw, Search, Sparkles, UserSearch } from "lucide-react";
import { useStore } from "@/lib/store";
import { callApi } from "@/lib/api";
import { aiReady, hasKey } from "@/lib/keys";
import { bookmarkletHref, captureIsProfile, parseCapture } from "@/lib/linkedinCapture";
import { DEFAULT_GENERAL_QUESTIONS } from "@/lib/defaults";
import { hookFor } from "@/lib/hooks";
import { bodyToPlain } from "@/lib/emailFormat";
import { STATUS_LABEL, type CoffeePrep, type Contact } from "@/lib/types";
import { cn, fmtDate, linkedinSlug, relDays } from "@/lib/util";
import { Button, Card, Checkbox, Empty, Input, PageHeader, StatusBadge, Textarea, toast } from "@/components/ui";
import { AddContactModal } from "@/components/AddContact";

export default function PrepPage() {
  return (
    <Suspense>
      <PrepInner />
    </Suspense>
  );
}

/** People most likely to call first: replied / call scheduled, then recently emailed, then everyone else. */
function rank(c: Contact) {
  if (c.status === "call_scheduled") return 0;
  if (c.status === "replied") return 1;
  if (c.status === "sent" || c.status === "followed_up") return 2;
  if (c.status === "drafted") return 3;
  return 4;
}

type Capture = { name: string; linkedin: string; text: string; bank?: string; title: string };

/** Parse a bookmarklet capture from the URL hash (untrusted: parseCapture validates and caps it). */
function readIncoming(): { match?: { id: string; name: string; text: string; linkedin: string }; capture?: Capture; error?: string } | null {
  if (typeof window === "undefined" || !window.location.hash.startsWith("#li=")) return null;
  const hash = window.location.hash;
  const all = useStore.getState().contacts;
  const person = captureIsProfile(hash) ? parseCapture(hash, [...new Set(all.map((c) => c.bank))])[0] : undefined;
  if (!person) return { error: "That wasn't a single LinkedIn profile. Open the person's profile page, then click the bookmark." };
  const slug = linkedinSlug(person.linkedin);
  const match =
    all.find((c) => c.linkedin && linkedinSlug(c.linkedin) === slug) ??
    all.find((c) => c.name.toLowerCase() === person.name.toLowerCase() && (person.bank === "Unknown" || c.bank === person.bank));
  if (match) return { match: { id: match.id, name: match.name, text: person.snippet, linkedin: match.linkedin || person.linkedin } };
  return { capture: { name: person.name, linkedin: person.linkedin, text: person.snippet, bank: person.bank !== "Unknown" ? person.bank : undefined, title: person.title } };
}

function PrepInner() {
  const params = useSearchParams();
  const router = useRouter();
  const contacts = useStore((s) => s.contacts);
  const updateContact = useStore((s) => s.updateContact);
  const [q, setQ] = useState("");
  // A profile sent by the "Send to Coverage" bookmark (the user had it open on LinkedIn) arrives in the URL hash.
  // Read once on mount: a known person gets the profile attached; someone new is offered "Add as contact".
  const [incoming] = useState(() => readIncoming());
  const [capture, setCapture] = useState<Capture | null>(incoming?.capture ?? null);
  const [addOpen, setAddOpen] = useState(false);
  const id = params.get("id") ?? "";
  const selected = contacts.find((c) => c.id === id);
  const select = (cid: string) => router.replace(`/prep?id=${encodeURIComponent(cid)}`);

  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || !incoming) return;
    handled.current = true;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    if (incoming.error) toast.err(incoming.error);
    if (incoming.match) {
      useStore.getState().updateContact(incoming.match.id, {
        profile: { text: incoming.match.text, source: "linkedin", capturedAt: new Date().toISOString() },
        linkedin: incoming.match.linkedin,
      });
      toast.ok(`Saved ${incoming.match.name}'s LinkedIn profile. Hit "Prep me" when you're ready.`);
      router.replace(`/prep?id=${encodeURIComponent(incoming.match.id)}`);
    }
  }, [incoming, router]);

  // After "Add as contact" for a captured profile, attach the capture to the new contact and open it.
  const closeAdd = () => {
    setAddOpen(false);
    if (!capture) return;
    const slug = linkedinSlug(capture.linkedin);
    const added = useStore.getState().contacts.find((c) => c.linkedin && linkedinSlug(c.linkedin) === slug);
    if (!added) return;
    updateContact(added.id, { profile: { text: capture.text, source: "linkedin", capturedAt: new Date().toISOString() } });
    setCapture(null);
    select(added.id);
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return contacts
      .filter((c) => c.status !== "ignored" && (!needle || `${c.name} ${c.bank} ${c.team ?? ""}`.toLowerCase().includes(needle)))
      .sort((a, b) => rank(a) - rank(b) || (b.lastTouchAt ?? b.sentAt ?? "").localeCompare(a.lastTouchAt ?? a.sentAt ?? "") || a.name.localeCompare(b.name))
      .slice(0, 200);
  }, [contacts, q]);

  return (
    <>
      <PageHeader title="Coffee chat prep" sub="Caught off guard by a “free to hop on a call now?” Pick the person and you'll have a brief, your intro, and questions in a few seconds." />

      {capture && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 border-brass/40 bg-brass-soft/60 p-3 text-[13px]">
          <UserSearch className="size-4 text-[#0a66c2]" />
          <span>
            Got <b>{capture.name}</b>&apos;s profile from LinkedIn, but they&apos;re not in your contacts yet.
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
            Add as contact &amp; prep
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCapture(null)}>
            Dismiss
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="flex max-h-[78vh] flex-col overflow-hidden">
          <div className="border-b border-line p-2.5">
            <div className="relative">
              <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted" />
              <Input className="h-8 pl-8" placeholder="Who's calling?" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            </div>
          </div>
          <ul className="flex-1 divide-y divide-line overflow-y-auto">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => select(c.id)}
                  className={cn("w-full px-3 py-2 text-left hover:bg-[#fbfaf6]", c.id === id && "bg-blue-soft/50")}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{c.name}</span>
                    {c.prep && <Check className="size-3 shrink-0 text-green" aria-label="Prepped" />}
                    <span className="ml-auto shrink-0">
                      <StatusBadge status={c.status} />
                    </span>
                  </div>
                  <div className="truncate text-[11.5px] text-muted">
                    {[c.bank, [c.region !== "Other" ? c.region : "", c.team].filter(Boolean).join(" "), c.position].filter(Boolean).join(" · ")}
                  </div>
                </button>
              </li>
            ))}
            {!list.length && <li className="p-4 text-center text-[12.5px] text-muted">No one matches.</li>}
          </ul>
        </Card>

        {selected ? (
          <PrepView key={selected.id} c={selected} />
        ) : (
          <Card>
            <Empty icon={<Coffee className="size-6" />} title="Pick someone to prep for">
              People who replied or have a call scheduled are at the top. Or open their LinkedIn profile and click the <b>Send to Coverage</b> bookmark:
              it lands here with their profile attached.
              {contacts.length === 0 && (
                <div className="mt-4">
                  <Link href="/" className="inline-flex items-center gap-1.5 rounded-md bg-navy px-3.5 py-2 text-[13.5px] font-medium text-white hover:bg-[#1c3259]">
                    Upload your spreadsheet first
                  </Link>
                </div>
              )}
            </Empty>
          </Card>
        )}
      </div>

      <AddContactModal
        open={addOpen}
        onClose={closeAdd}
        initial={capture ? { name: capture.name, linkedin: capture.linkedin, bank: capture.bank ?? "", position: capture.title.slice(0, 120) } : undefined}
      />
    </>
  );
}

function PrepView({ c }: { c: Contact }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const updateContact = useStore((s) => s.updateContact);
  const contacts = useStore((s) => s.contacts);
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");
  const canSearch = hasKey(settings, "serper") || hasKey(settings, "brave");
  const [searchWeb, setSearchWeb] = useState(canSearch);
  const bookmarkRef = useRef<HTMLAnchorElement>(null);
  const general = settings.prep?.generalQuestions?.length ? settings.prep.generalQuestions : DEFAULT_GENERAL_QUESTIONS;
  const prep = c.prep;

  // React blocks javascript: hrefs in JSX, so the bookmarklet is set on the element directly.
  useEffect(() => {
    bookmarkRef.current?.setAttribute("href", bookmarkletHref(window.location.origin));
  }, [pasting, c.profile]);

  const savePaste = () => {
    const text = paste.replace(/\s+\n/g, "\n").trim().slice(0, 15000);
    if (text.length < 40) return toast.err("That's too short to be a profile. On their LinkedIn page press Ctrl+A, Ctrl+C, then paste here.");
    updateContact(c.id, { profile: { text, source: "paste", capturedAt: new Date().toISOString() } });
    setPaste("");
    setPasting(false);
    toast.ok("Profile saved.");
  };

  const generate = async () => {
    if (!aiReady(settings)) return toast.err("Add an AI key in Settings first.");
    setBusy(true);
    try {
      const p = settings.profile;
      const lastEmail = c.draft ? `Subject: ${c.draft.subject}\n\n${bodyToPlain(c.draft.body)}` : "";
      const r = await callApi<Omit<CoffeePrep, "generatedAt" | "asked" | "notes"> & { warnings: string[] }>(
        "/api/prep",
        {
          contact: {
            name: c.name,
            bank: c.bank,
            position: c.position,
            location: c.location,
            team: c.team ?? "",
            school: c.school ?? "",
            notes: c.comment.slice(0, 2000),
            status: STATUS_LABEL[c.status],
            history: [
              c.sentAt ? `First emailed ${fmtDate(c.sentAt)}` : "",
              c.followUps ? `${c.followUps} follow-up(s)` : "",
              c.repliedAt ? `Replied ${fmtDate(c.repliedAt)}` : "",
            ]
              .filter(Boolean)
              .join("; "),
          },
          profileText: c.profile?.text ?? c.headline ?? "",
          me: {
            name: p.name,
            school: p.school,
            year: p.year,
            major: p.major,
            hometown: p.hometown,
            club: p.club,
            pitch: hookFor(c, settings).text,
          },
          lastEmail: lastEmail.slice(0, 4000),
          searchWeb: searchWeb && canSearch,
        },
        settings,
      );
      r.warnings.forEach((w) => toast.info(w));
      updateContact(c.id, {
        prep: { generatedAt: new Date().toISOString(), brief: r.brief, path: r.path, commonGround: r.commonGround, intro: r.intro, tailored: r.tailored, sources: r.sources, notes: prep?.notes, asked: [] },
      });
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleAsked = (k: string) => {
    if (!prep) return;
    const asked = new Set(prep.asked ?? []);
    if (asked.has(k)) asked.delete(k);
    else asked.add(k);
    updateContact(c.id, { prep: { ...prep, asked: [...asked] } });
  };

  const copyAll = () => {
    const lines = [
      `${c.name} · ${[c.position, c.bank, c.team, c.location].filter(Boolean).join(" · ")}`,
      prep?.brief ?? "",
      prep?.intro ? `\nMy intro:\n${prep.intro}` : "",
      prep?.commonGround.length ? `\nCommon ground:\n${prep.commonGround.map((x) => `- ${x}`).join("\n")}` : "",
      `\nGeneral questions:\n${general.map((g, i) => `${i + 1}. ${g}`).join("\n")}`,
      prep?.tailored.length ? `\nFor ${c.firstName || c.name}:\n${prep.tailored.map((t, i) => `${i + 1}. ${t.question}`).join("\n")}` : "",
    ];
    navigator.clipboard.writeText(lines.filter(Boolean).join("\n")).then(
      () => toast.ok("Copied. Paste it into your notes app."),
      () => toast.err("Couldn't copy."),
    );
  };

  const others = contacts.filter((o) => o.bank === c.bank && o.id !== c.id && (o.sentAt || o.status !== "new")).slice(0, 4);

  return (
    <div className="min-w-0 space-y-4 print:space-y-3">
      {/* Who */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-serif text-[26px] leading-tight">{c.name}</h2>
              <StatusBadge status={c.status} />
              {c.linkedin && (
                <a href={c.linkedin} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12.5px] text-[#0a66c2] hover:underline">
                  LinkedIn <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <div className="mt-0.5 text-[13.5px] text-ink-2">{[c.position, c.bank, [c.location, c.team].filter(Boolean).join(" · ")].filter(Boolean).join(" · ")}</div>
            <div className="mt-1 text-[12px] text-muted">
              {[c.sentAt && `emailed ${relDays(c.sentAt)}`, c.repliedAt && `replied ${relDays(c.repliedAt)}`, c.school, c.comment && `“${c.comment.slice(0, 120)}”`].filter(Boolean).join(" · ")}
            </div>
            {others.length > 0 && (
              <div className="mt-1 text-[12px] text-muted">Also contacted at {c.bank}: {others.map((o) => o.name).join(", ")}</div>
            )}
          </div>
          <div className="flex shrink-0 gap-1.5 print:hidden">
            {prep && (
              <>
                <Button size="sm" icon={<ClipboardCopy className="size-3.5" />} onClick={copyAll}>
                  Copy
                </Button>
                <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>
                  Print
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Sources */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12.5px] print:hidden">
          {c.profile ? (
            <span className="flex items-center gap-1.5 text-green">
              <Check className="size-3.5" /> LinkedIn profile {c.profile.source === "paste" ? "pasted" : "captured"} {relDays(c.profile.capturedAt)}
              <span className="text-muted">({Math.round(c.profile.text.length / 100) / 10}k chars)</span>
            </span>
          ) : (
            <span className="text-amber">No LinkedIn profile yet: questions will be more generic.</span>
          )}
          <button className="text-navy hover:underline" onClick={() => setPasting(!pasting)}>
            {c.profile ? "Update profile" : "Add their profile"}
          </button>
          <div className="flex-1" />
          <label className={cn("flex items-center gap-1.5", !canSearch && "opacity-50")} title={canSearch ? "Looks for bank bios, news and deal announcements (not LinkedIn)" : "Add a Serper or Brave key in Settings"}>
            <Checkbox checked={searchWeb && canSearch} onChange={setSearchWeb} /> Also search the web
          </label>
          <Button variant="brass" loading={busy} icon={prep ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-3.5" />} onClick={generate}>
            {prep ? "Redo prep" : "Prep me"}
          </Button>
        </div>

        {pasting && (
          <div className="mt-3 space-y-2 rounded-lg bg-[#fbfaf6] p-3 text-[12.5px] text-ink-2 print:hidden">
            <p>
              <b>Fastest:</b> open{" "}
              {c.linkedin ? (
                <a href={c.linkedin} target="_blank" rel="noreferrer" className="text-[#0a66c2] underline">
                  their profile
                </a>
              ) : (
                "their LinkedIn profile"
              )}{" "}
              (scroll once so Experience loads), then click the{" "}
              <a
                ref={bookmarkRef}
                onClick={(e) => {
                  e.preventDefault();
                  toast.info("Drag it to your bookmarks bar, then click it while on their LinkedIn profile.");
                }}
                className="inline-flex cursor-grab items-center gap-1 rounded-md bg-[#0a66c2] px-2 py-0.5 text-[12px] font-medium text-white"
              >
                <Bookmark className="size-3" /> Send to Coverage
              </a>{" "}
              bookmark (drag it to your bookmarks bar once). It reads only the page you have open.
            </p>
            <p>Or on their profile press Ctrl+A, Ctrl+C and paste here:</p>
            <Textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste their LinkedIn profile text…" />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={savePaste} disabled={!paste.trim()}>
                Save profile
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPasting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>

      {prep ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[1.3fr_1fr]">
            <Card className="p-4">
              <SectionTitle>The 30-second brief</SectionTitle>
              <p className="text-[14px] leading-relaxed">{prep.brief}</p>
              {prep.path.length > 0 && (
                <ol className="mt-3 space-y-1 border-l-2 border-line pl-3 text-[12.5px]">
                  {prep.path.map((p, i) => (
                    <li key={i}>
                      <span className="font-medium">{p.role}</span>
                      {p.org && <span className="text-ink-2"> · {p.org}</span>}
                      {p.when && <span className="num text-muted"> · {p.when}</span>}
                    </li>
                  ))}
                </ol>
              )}
              {prep.commonGround.length > 0 && (
                <div className="mt-3">
                  <SectionTitle>Common ground</SectionTitle>
                  <ul className="space-y-1 text-[13px]">
                    {prep.commonGround.map((x, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="text-green">●</span> {x}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
            <Card className="p-4">
              <SectionTitle>Your intro (if they say “tell me about yourself”)</SectionTitle>
              <p className="text-[13.5px] leading-relaxed text-ink-2">{prep.intro}</p>
              {!hookFor(c, settings).text && (
                <p className="mt-2 text-[11.5px] text-muted">No hook for {c.firstName || c.name}&apos;s team ({hookFor(c, settings).name}). Hooks are on Email drafts.</p>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
            <Card className="p-4">
              <SectionTitle>Tailored for {c.firstName || c.name}</SectionTitle>
              <QuestionList items={prep.tailored.map((t, i) => ({ key: `t${i}`, text: t.question, why: t.why }))} asked={prep.asked ?? []} onToggle={toggleAsked} />
            </Card>
            <Card className="p-4">
              <GeneralHeader general={general} onSave={(qs) => setSettings((s) => ({ ...s, prep: { ...s.prep, generalQuestions: qs } }))} />
              <QuestionList items={general.map((g, i) => ({ key: `g${i}`, text: g }))} asked={prep.asked ?? []} onToggle={toggleAsked} />
            </Card>
          </div>

          <Card className="p-4 print:hidden">
            <SectionTitle>Call notes</SectionTitle>
            <Textarea
              rows={4}
              defaultValue={prep.notes ?? ""}
              placeholder="What they said, names they mentioned, what to put in your thank-you email…"
              onBlur={(e) => e.target.value !== (prep.notes ?? "") && updateContact(c.id, { prep: { ...prep, notes: e.target.value } })}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px] text-muted">
              <span>Prepped {relDays(prep.generatedAt)}. Notes save when you click away.</span>
              {c.status !== "call_scheduled" && c.status !== "done" && (
                <button className="text-navy hover:underline" onClick={() => useStore.getState().setStatus([c.id], "call_scheduled", "Coffee chat")}>
                  Mark as call scheduled
                </button>
              )}
              {prep.sources.length > 0 && (
                <span className="flex flex-wrap gap-x-2">
                  Web sources:
                  {prep.sources.map((s) => (
                    <a key={s.link} href={s.link} target="_blank" rel="noreferrer" className="max-w-56 truncate text-navy hover:underline" title={s.title}>
                      {s.title}
                    </a>
                  ))}
                </span>
              )}
            </div>
          </Card>
        </>
      ) : (
        <Card className="p-4">
          <GeneralHeader general={general} onSave={(qs) => setSettings((s) => ({ ...s, prep: { ...s.prep, generalQuestions: qs } }))} />
          <QuestionList items={general.map((g, i) => ({ key: `g${i}`, text: g }))} asked={[]} />
          <p className="mt-3 text-[12px] text-muted">
            These work for anyone, even with no prep. Hit <b>Prep me</b> for a brief, your intro, and 3–5 questions tailored to {c.firstName || c.name}.
          </p>
        </Card>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">{children}</div>;
}

function QuestionList({ items, asked, onToggle }: { items: { key: string; text: string; why?: string }[]; asked: string[]; onToggle?: (k: string) => void }) {
  return (
    <ol className="space-y-2">
      {items.map((it, i) => {
        const done = asked.includes(it.key);
        return (
          <li key={it.key} className="flex gap-2">
            {onToggle ? (
              <button
                onClick={() => onToggle(it.key)}
                aria-label={done ? "Mark as not asked" : "Mark as asked"}
                className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border print:hidden", done ? "border-green bg-green text-white" : "border-line-2 hover:border-navy")}
              >
                {done && <Check className="size-3" />}
              </button>
            ) : (
              <span className="num w-4 shrink-0 text-[12px] text-muted">{i + 1}.</span>
            )}
            <div className={cn("text-[13.5px] leading-snug", done && "text-muted line-through")}>
              {it.text}
              {it.why && <div className="text-[11.5px] text-muted no-underline">{it.why}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** "Ask anyone" questions, editable one per line (saved in settings for every contact). */
function GeneralHeader({ general, onSave }: { general: string[]; onSave: (qs: string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(general.join("\n"));
  return (
    <>
      <div className="mb-1.5 flex items-center gap-2">
        <SectionTitle>General (ask anyone)</SectionTitle>
        <button className="mb-1.5 ml-auto text-muted hover:text-navy print:hidden" aria-label="Edit general questions" onClick={() => setEditing(!editing)}>
          <Pencil className="size-3.5" />
        </button>
      </div>
      {editing && (
        <div className="mb-3 space-y-1.5">
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                const qs = text.split("\n").map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean).slice(0, 8);
                if (!qs.length) return toast.err("Add at least one question.");
                onSave(qs);
                setEditing(false);
              }}
            >
              Save
            </Button>
            <button className="text-[12px] text-muted hover:underline" onClick={() => setText(DEFAULT_GENERAL_QUESTIONS.join("\n"))}>
              Reset to defaults
            </button>
            <span className="text-[11.5px] text-muted">One per line. Used for everyone.</span>
          </div>
        </div>
      )}
    </>
  );
}
