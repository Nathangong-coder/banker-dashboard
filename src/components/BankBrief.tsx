"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, ChevronRight, ClipboardCopy, ExternalLink, NotebookPen, RefreshCw, Sparkles } from "lucide-react";
import { useStore } from "@/lib/store";
import { callApi } from "@/lib/api";
import { aiReady, hasKey } from "@/lib/keys";
import { canonBank } from "@/lib/banks";
import { hookFor } from "@/lib/hooks";
import type { BankBrief as Brief } from "@/lib/coverage";
import type { BankMeta, Contact, Settings } from "@/lib/types";
import { cn, fmtDate, relDays } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Input, toast } from "@/components/ui";
import { InterestsEditor, interestsLabel, useInterests } from "@/components/PrepInterests";

type Note = { who: string; text: string };

/**
 * Everything the user has written about a bank: firm notes (/firms), BankMeta notes, and for each contact there the
 * sheet comment, call notes, chat notes and the chat grade's summary / thank-you points. Sent to "Why <Bank>".
 */
export function bankNotes(key: string, contacts: Contact[], banks: Record<string, BankMeta>, firmNotes?: string): Note[] {
  const out: Note[] = [];
  const add = (who: string, text?: string) => {
    const t = text?.trim();
    if (t) out.push({ who, text: t.slice(0, 1500) });
  };
  add("Your firm notes (/firms)", firmNotes);
  for (const b of Object.values(banks)) if (canonBank(b.name) === key) add(`Your notes on ${b.name} (${b.region})`, b.notes);
  for (const c of contacts) {
    if (canonBank(c.bank) !== key) continue;
    add(`Your tracker comment on ${c.name}`, c.comment);
    add(`Your call notes with ${c.name}`, c.prep?.notes);
    for (const ch of c.chats ?? []) {
      const when = fmtDate(ch.at);
      add(`Your chat with ${c.name} (${when})`, ch.notes);
      if (ch.grade) {
        add(`Your chat with ${c.name} (${when}), summary`, ch.grade.summary);
        if (ch.grade.thankYouPoints.length) add(`Your chat with ${c.name} (${when}), what they said`, ch.grade.thankYouPoints.join("; "));
      }
    }
  }
  return out.slice(0, 40);
}

/**
 * Bank brief for coffee chats (/prep): recent standout deals the bank advised on in your sub-verticals (web search + AI,
 * every deal with its source) and a "Why <Bank>" answer from your notes. Cached per bank in `coverage.bankBriefs`.
 */
export function BankBrief({ bank: initial, contact }: { bank?: string; contact?: Contact }) {
  const settings = useStore((s) => s.settings);
  const contacts = useStore((s) => s.contacts);
  const banks = useStore((s) => s.banks);
  const added = useStore((s) => s.coverage.added);
  const briefs = useStore((s) => s.coverage.bankBriefs);
  const ratings = useStore((s) => s.coverage.ratings);
  const setCoverage = useStore((s) => s.setCoverage);
  const interests = useInterests();
  const [bank, setBank] = useState(initial ?? "");
  const [typed, setTyped] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [showInterests, setShowInterests] = useState(false);

  const key = bank.trim() ? canonBank(bank) : "";
  const brief = key ? briefs?.[key] : undefined;
  const notes = useMemo(() => (key ? bankNotes(key, contacts, banks, ratings?.[key]?.notes) : []), [key, contacts, banks, ratings]);
  const options = useMemo(() => {
    const names = new Map<string, string>();
    for (const n of [...contacts.map((c) => c.bank), ...added.map((t) => t.name), ...Object.values(briefs ?? {}).map((b) => b.bank)]) {
      const k = n.trim() && canonBank(n);
      if (k && !names.has(k)) names.set(k, n.trim());
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [contacts, added, briefs]);

  const canSearch = hasKey(settings, "serper") || hasKey(settings, "brave");
  const subs = [...new Set(interests.flatMap((i) => (i.subVerticals.length ? i.subVerticals : [i.sector])).map((x) => x.trim()).filter(Boolean))];
  const stale = brief && brief.interests.join("|") !== subs.slice(0, 4).join("|");

  const pick = (name: string) => {
    setTyped(name);
    setBank(name.trim());
  };

  const generate = async () => {
    if (!key) return toast.err("Pick a bank first.");
    if (!aiReady(settings)) return toast.err("Add an AI key in Settings → Data first.");
    if (!canSearch) return toast.err("The bank brief searches the web for recent deals. Add a Serper key (or Brave Search) in Settings → Data.");
    setBusy(true);
    try {
      const r = await callApi<Omit<Brief, "generatedAt"> & { warnings: string[] }>(
        "/api/prep/bank",
        {
          bank: bank.trim(),
          interests: interests.filter((i) => i.sector.trim()),
          notes,
          me: meFor(settings, contact),
        },
        settings,
      );
      const { warnings, ...rest } = r;
      warnings.forEach((w) => toast.info(w));
      setCoverage((c) => ({ ...c, bankBriefs: { ...c.bankBriefs, [key]: { ...rest, generatedAt: new Date().toISOString() } } }));
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyWhy = () => {
    if (!brief) return;
    const text = [`Why ${brief.bank}?`, ...brief.why.bullets.map((b) => `- ${b.text}`), "", brief.why.spoken].join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.ok("Copied."),
      () => toast.err("Couldn't copy."),
    );
  };

  return (
    <Card className="print:break-inside-avoid">
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            <Building2 className="size-4 text-muted" /> Bank brief{bank ? `: ${bank}` : ""}
          </span>
        }
        sub="Recent standout deals in your sectors, and your answer to “Why this bank?”"
        right={
          <form
            className="flex items-center gap-1.5 print:hidden"
            onSubmit={(e) => {
              e.preventDefault();
              pick(typed);
            }}
          >
            <Input
              className="h-7 w-44 text-[12.5px]"
              list="bank-brief-banks"
              placeholder="Any bank…"
              aria-label="Bank"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                // Picking from the list sets it right away; typing waits for Enter.
                if (options.includes(e.target.value)) setBank(e.target.value);
              }}
              onBlur={() => typed.trim() && typed.trim() !== bank && pick(typed)}
            />
            <datalist id="bank-brief-banks">
              {options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
            <Button
              type="button"
              size="sm"
              variant={brief ? "secondary" : "brass"}
              loading={busy}
              disabled={!key}
              icon={brief ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-3.5" />}
              onClick={generate}
            >
              {brief ? "Refresh" : "Build brief"}
            </Button>
          </form>
        }
      />

      <div className="space-y-4 p-4">
        {/* Interests (collapsed): what the deal search looks for. */}
        <div className="text-[12.5px] print:hidden">
          <button className="flex items-center gap-1 text-ink-2 hover:text-navy" onClick={() => setShowInterests(!showInterests)} aria-expanded={showInterests}>
            <ChevronRight className={cn("size-3.5 transition-transform", showInterests && "rotate-90")} />
            Your interests: <span className="font-medium">{interestsLabel(interests)}</span>
          </button>
          {showInterests && (
            <div className="mt-2 rounded-lg bg-subtle p-3">
              <InterestsEditor />
              <p className="mt-2 text-[11.5px] text-muted">Also in Settings → Profile. Refresh the brief after changing them.</p>
            </div>
          )}
        </div>

        {!key ? (
          <p className="text-[13px] text-muted">Type or pick a bank to see its recent deals in your sectors and a “Why this bank” answer.</p>
        ) : !brief ? (
          <div className="text-[13px] text-ink-2">
            <p>
              <b>Build brief</b> searches the web for {bank}&apos;s recent deals in {subs.length ? subs.slice(0, 4).join(", ") : "its core sectors"} and drafts your
              “Why {bank}?” answer{" "}
              {notes.length ? (
                <>from {notes.length} of your notes on {bank}.</>
              ) : (
                <>. You have no notes on {bank} yet, so it&apos;ll be a generic version.</>
              )}
            </p>
            {!canSearch && (
              <p className="mt-1.5 text-amber">
                Needs a web search key: add Serper (or Brave Search) in{" "}
                <Link href="/settings?tab=data" className="underline">
                  Settings → Data
                </Link>
                .
              </p>
            )}
          </div>
        ) : (
          <>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                Recent deals in your sectors
                {stale && (
                  <Badge tone="amber" className="normal-case tracking-normal">
                    Interests changed: refresh
                  </Badge>
                )}
              </div>
              {brief.deals.length ? (
                <ol className="space-y-2.5">
                  {brief.deals.map((d, i) => (
                    <li key={`${d.sourceLink}:${i}`} className="rounded-lg border border-line p-3">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-[13.5px] font-semibold">
                          {d.acquirer && !/not found/i.test(d.acquirer) ? `${d.acquirer} / ${d.target}` : d.target}
                        </span>
                        <Badge tone={/undisclosed|not found/i.test(d.value) ? "neutral" : "green"} className="num">
                          {d.value}
                        </Badge>
                        {d.subVertical && <Badge tone="blue">{d.subVertical}</Badge>}
                        {d.date && !/not found/i.test(d.date) && <span className="num text-[12px] text-muted">{d.date}</span>}
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-ink-2">
                        {bank}: <span className="font-medium">{d.bankRole}</span>
                      </div>
                      <p className="mt-1 text-[12.5px] text-ink-2">{d.whyNotable}</p>
                      <p className="mt-1.5 border-l-2 border-brass pl-2 text-[13px] italic">{d.talkingPoint}</p>
                      <a
                        href={d.sourceLink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex max-w-full items-center gap-1 text-[11.5px] text-navy hover:underline"
                        title={d.sourceTitle}
                      >
                        <span className="truncate">{d.sourceTitle}</span> <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[13px] text-muted">No deals in your sectors with {bank}&apos;s role were found in the search results.</p>
              )}
              {brief.dealsNote && <p className="mt-1.5 text-[11.5px] text-muted">{brief.dealsNote}</p>}
              <p className="mt-1 text-[11.5px] text-muted">From web search: open the source before quoting a number in a chat.</p>
            </div>

            <div className="rounded-lg border border-line bg-subtle p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Why {brief.bank}?</span>
                {brief.why.generic ? (
                  <Badge tone="amber">Generic: no notes of yours went in</Badge>
                ) : (
                  <Badge tone="green">
                    <NotebookPen className="size-3" /> Uses your notes
                  </Badge>
                )}
                <Button size="sm" variant="ghost" className="ml-auto print:hidden" icon={<ClipboardCopy className="size-3.5" />} onClick={copyWhy}>
                  Copy
                </Button>
              </div>
              <ul className="space-y-1.5 text-[13px]">
                {brief.why.bullets.map((b, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className={b.fromNotes ? "text-green" : "text-muted"}>●</span>
                    <span>
                      {b.text}
                      {b.source && <span className="ml-1 text-[11.5px] text-muted">({b.fromNotes ? b.source : sourceLabel(b.source, brief)})</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Say it (about 60 words)</div>
              <p className="mt-1 text-[13.5px] leading-relaxed">{brief.why.spoken}</p>
              {brief.why.generic && (
                <p className="mt-2 text-[11.5px] text-muted">
                  Make it yours: after a chat with someone at {brief.bank}, add notes (Transcripts &amp; grades on this page, or the firm&apos;s notes on{" "}
                  <Link href="/firms" className="underline">
                    Firms
                  </Link>
                  ) and refresh.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
              <span>
                Built {relDays(brief.generatedAt)} for {brief.interests.join(", ") || "core sectors"}
                {notes.length ? ` · ${notes.length} note${notes.length === 1 ? "" : "s"} on ${bank} now` : ""}.
              </span>
              {brief.sources.length > 0 && (
                <details>
                  <summary className="cursor-pointer hover:text-navy">{brief.sources.length} search results</summary>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                    {brief.sources.map((s) => (
                      <li key={s.link}>
                        <a href={s.link} target="_blank" rel="noreferrer" className="text-navy hover:underline">
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/** "[3]" → that result's title. */
function sourceLabel(source: string, brief: Brief) {
  const n = Number(source.match(/^\[(\d+)\]$/)?.[1]);
  return n && brief.sources[n - 1] ? `web: ${brief.sources[n - 1].title}` : source;
}

function meFor(settings: Settings, c?: Contact): Record<string, string> {
  const p = settings.profile;
  const me: Record<string, string> = { name: p.name, school: p.school, year: p.year, major: p.major, hometown: p.hometown, club: p.club };
  if (c) me.pitch = hookFor(c, settings).text;
  for (const k of Object.keys(me)) if (!me[k]) delete me[k];
  return me;
}
