"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Star, Trophy, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { firmScore, firmStats, gotReplied, overallReplyRate, wasEmailed, type FirmScore, type FirmStats } from "@/lib/firmScore";
import { tierIndex } from "@/lib/segments";
import type { FirmRating } from "@/lib/coverage";
import type { Contact } from "@/lib/types";
import { cn, fmtDate, relDays } from "@/lib/util";
import { Badge, Card, CardHeader, Checkbox, Empty, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";

type Sort = "score" | "stars" | "replies" | "name";
const SORTS: { id: Sort; label: string }[] = [
  { id: "score", label: "Score" },
  { id: "stars", label: "Your stars" },
  { id: "replies", label: "Replies" },
  { id: "name", label: "Name" },
];

type Row = FirmStats & { rating?: FirmRating; result?: FirmScore; tier?: string };

const NO_RATINGS: Record<string, FirmRating> = {};

/** The summary tiles: each one is a set of firms, and clicking it shows which firms (and which people) make it up. */
type Zoom = "emailed" | "replied" | "chatted" | "referral";

/** You've talked to them, or a call is booked: a logged chat, a call on the calendar, or status done. */
const chatted = (c: Contact) => !!c.chats?.length || !!c.call || c.status === "done";

const md = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric" }) : "");

const ZOOMS: { id: Zoom; label: string; people: (c: Contact) => boolean; line: (c: Contact) => string }[] = [
  { id: "emailed", label: "Firms emailed", people: wasEmailed, line: (c) => `${c.name}${c.sentAt ? ` · ${md(c.sentAt)}` : ""}${c.followUps ? ` · ${c.followUps} follow-up${c.followUps > 1 ? "s" : ""}` : ""}` },
  { id: "replied", label: "Firms that replied", people: gotReplied, line: (c) => `${c.name}${c.repliedAt ? ` replied ${md(c.repliedAt)}` : " replied"}` },
  {
    id: "chatted",
    label: "Firms you've chatted with",
    people: chatted,
    line: (c) => {
      const chat = [...(c.chats ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0];
      if (chat) return `${c.name} · ${md(chat.at)}${chat.grade ? ` · ${chat.grade.letter} (${chat.grade.score})` : ""}${(c.chats?.length ?? 0) > 1 ? ` · ${c.chats!.length} chats` : ""}`;
      if (c.call) return `${c.name} · call ${Date.parse(c.call.at) > Date.now() ? "booked " : ""}${md(c.call.at)}`;
      return c.name;
    },
  },
  {
    id: "referral",
    label: "Firms with referrals",
    people: (c) => !!c.referral,
    line: (c) => `${c.name}${c.referral!.to?.length ? ` → ${c.referral!.to.map((t) => t.name).join(", ")}` : ""} · ${md(c.referral!.at)}${c.referral!.source === "sheet" ? " (ticked in sheet)" : ""}`,
  },
];

function saveRating(key: string, patch: Partial<FirmRating>) {
  useStore.getState().setCoverage((c) => {
    const prev = c.ratings?.[key];
    const next: FirmRating = { ...prev, ...patch, updatedAt: new Date().toISOString() };
    const ratings = { ...c.ratings };
    if (!next.stars && !next.notes?.trim()) delete ratings[key];
    else ratings[key] = next;
    return { ...c, ratings };
  });
}

function scoreTone(n: number) {
  if (n >= 60) return "green" as const;
  if (n >= 35) return "brass" as const;
  return "neutral" as const;
}

export default function FirmsPage() {
  const contacts = useStore((s) => s.contacts);
  const targets = useStore((s) => s.targets);
  const added = useStore((s) => s.coverage.added);
  const ratings = useStore((s) => s.coverage.ratings) ?? NO_RATINGS;
  const [sort, setSort] = useState<Sort>("score");
  const [emailedOnly, setEmailedOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom | null>(null);

  const stats = useMemo(() => firmStats(contacts), [contacts]);
  const overall = useMemo(() => overallReplyRate(stats), [stats]);
  const tiers = useMemo(() => tierIndex(targets, added), [targets, added]);

  const rows: Row[] = useMemo(() => {
    const list: Row[] = stats.map((s) => ({ ...s, rating: ratings[s.key], result: firmScore(s, overall), tier: tiers.get(s.key) }));
    const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);
    const cmp: Record<Sort, (a: Row, b: Row) => number> = {
      score: (a, b) => (b.result?.score ?? -1) - (a.result?.score ?? -1) || b.emailed - a.emailed || byName(a, b),
      stars: (a, b) => (b.rating?.stars ?? 0) - (a.rating?.stars ?? 0) || (b.result?.score ?? -1) - (a.result?.score ?? -1) || byName(a, b),
      replies: (a, b) => b.replied - a.replied || b.replyRate - a.replyRate || byName(a, b),
      name: byName,
    };
    const z = ZOOMS.find((x) => x.id === zoom);
    // Zoomed into a tile: only the firms behind it (the "emailed only" box doesn't apply then).
    return list.filter((r) => (z ? r.contacts.some(z.people) : !emailedOnly || r.emailed > 0)).sort(cmp[sort]);
  }, [stats, ratings, overall, tiers, sort, emailedOnly, zoom]);

  const totals = useMemo(() => {
    const started = stats.filter((s) => s.emailed > 0);
    return {
      started: started.length,
      firms: stats.length,
      replied: stats.filter((s) => s.replied > 0).length,
      calls: stats.reduce((n, s) => n + s.calls, 0),
      referrals: stats.reduce((n, s) => n + s.referrals, 0),
      chatted: stats.filter((s) => s.contacts.some(chatted)).length,
      referralFirms: stats.filter((s) => s.referrals > 0).length,
      people: Object.fromEntries(ZOOMS.map((z) => [z.id, stats.reduce((n, s) => n + s.contacts.filter(z.people).length, 0)])) as Record<Zoom, number>,
    };
  }, [stats]);

  if (!stats.length) {
    return (
      <>
        <PageHeader title="Firms" />
        <Card>
          <Empty icon={<Trophy className="size-6" />} title="No firms yet">
            Firms show up here once you have contacts. Upload your spreadsheet or add people on Find people.
            <div className="mt-4">
              <Link href="/" className="inline-flex items-center gap-1.5 rounded-lg bg-brass-strong px-3.5 py-2 text-[13.5px] font-medium text-white hover:bg-brass-hover">
                Upload your spreadsheet
              </Link>
            </div>
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Firms"
        sub="How networking is going at each firm: replies, calls, referrals and how your chats went, scored 0–100, next to your own stars and notes."
      />

      <Card className="grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
        {(
          [
            ["emailed", totals.started, `of ${totals.firms} with contacts · ${totals.people.emailed} people`],
            ["replied", totals.replied, `${totals.people.replied} people · ${Math.round(overall * 100)}% of emails get a reply`],
            ["chatted", totals.chatted, `${totals.people.chatted} ${totals.people.chatted === 1 ? "person" : "people"} talked to or booked · ${totals.calls} calls had`],
            ["referral", totals.referralFirms, `${totals.referrals} referral${totals.referrals === 1 ? "" : "s"}`],
          ] as const
        ).map(([id, value, sub]) => (
          <button
            key={id}
            type="button"
            onClick={() => setZoom(zoom === id ? null : id)}
            aria-pressed={zoom === id}
            className={cn("px-5 py-4 text-left transition-colors hover:bg-subtle", zoom === id && "bg-blue-soft/40 shadow-[inset_0_-2px_0_var(--navy)]")}
          >
            <div className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
              {ZOOMS.find((z) => z.id === id)!.label}
              <span className="shrink-0 text-[11px] text-navy">{zoom === id ? "Close" : "See which"}</span>
            </div>
            <div className={cn("num mt-1.5 text-[28px] leading-none font-medium tracking-tight", id === "referral" && value > 0 && "text-green")}>{value}</div>
            <div className="mt-1.5 text-[12px] text-muted">{sub}</div>
          </button>
        ))}
      </Card>

      {zoom && (
        <ZoomPanel
          zoom={zoom}
          stats={stats}
          onClose={() => setZoom(null)}
          onOpen={(k) => {
            setOpen(k);
            requestAnimationFrame(() => document.getElementById(`firm-${k}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
          }}
        />
      )}

      <Card>
        <CardHeader
          title="Your firms"
          sub={
            zoom ? (
              <span className="flex items-center gap-1.5">
                Only {ZOOMS.find((z) => z.id === zoom)!.label.toLowerCase()}
                <button className="flex items-center gap-0.5 text-navy hover:underline" onClick={() => setZoom(null)}>
                  <X className="size-3" /> show all
                </button>
              </span>
            ) : (
              "Click a firm for the score breakdown, your notes and its people."
            )
          }
          right={
            <>
              {!zoom && <Checkbox checked={emailedOnly} onChange={setEmailedOnly} label="Only firms I've emailed" />}
              <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                Sort
                <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-8" aria-label="Sort firms">
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </label>
            </>
          }
        />
        {rows.length === 0 ? (
          <Empty title="No firms emailed yet">Untick “Only firms I&apos;ve emailed” to see every firm you have contacts at.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="bg-subtle text-left text-[11px] uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Firm</th>
                  <th className="px-2 py-2 font-medium">Score</th>
                  <th className="px-2 py-2 font-medium">Your stars</th>
                  <th className="px-2 py-2 text-right font-medium">Emailed</th>
                  <th className="px-2 py-2 text-right font-medium">Replied</th>
                  <th className="px-2 py-2 text-right font-medium">Calls</th>
                  <th className="px-2 py-2 text-right font-medium">Referrals</th>
                  <th className="px-2 py-2 text-right font-medium">Chat grade</th>
                  <th className="px-4 py-2 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = open === r.key;
                  return (
                    <Fragment key={r.key}>
                      <tr
                        id={`firm-${r.key}`}
                        className={cn("cursor-pointer border-b border-line hover:bg-subtle", isOpen && "bg-subtle")}
                        onClick={() => setOpen(isOpen ? null : r.key)}
                      >
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-left font-medium text-ink"
                            aria-expanded={isOpen}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpen(isOpen ? null : r.key);
                            }}
                          >
                            {isOpen ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}
                            {r.name}
                          </button>
                          <div className="mt-0.5 pl-5 text-[11.5px] text-muted">
                            {[r.tier, `${r.contacts.length} ${r.contacts.length === 1 ? "person" : "people"}`, r.regions.join(" · "), r.teams.join(", ")]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          {r.result ? (
                            <span title={r.result.parts.map((p) => `${p.label}: ${p.points}/${p.max}`).join("\n")}>
                              <Badge tone={scoreTone(r.result.score)} className="num text-[12.5px]">
                                {r.result.score}
                              </Badge>
                            </span>
                          ) : (
                            <span className="text-[12px] text-muted">Not started</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Stars value={r.rating?.stars} onChange={(stars) => saveRating(r.key, { stars })} firm={r.name} />
                        </td>
                        <td className="num px-2 py-2.5 text-right">{r.emailed}</td>
                        <td className="num px-2 py-2.5 text-right">
                          {r.replied}
                          {r.emailed > 0 && <span className="ml-1 text-[11.5px] text-muted">({Math.round(r.replyRate * 100)}%)</span>}
                        </td>
                        <td className="num px-2 py-2.5 text-right">
                          {r.calls}
                          {r.upcomingCalls > 0 && <span className="ml-1 text-[11.5px] text-muted">+{r.upcomingCalls} soon</span>}
                        </td>
                        <td className="num px-2 py-2.5 text-right">{r.referrals}</td>
                        <td className="num px-2 py-2.5 text-right">{r.avgChatGrade === undefined ? <span className="text-muted">—</span> : Math.round(r.avgChatGrade)}</td>
                        <td className="px-4 py-2.5 text-[12.5px] text-ink-2">{r.lastActivity ? relDays(r.lastActivity) : <span className="text-muted">—</span>}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-line bg-subtle">
                          <td colSpan={9} className="px-4 py-4">
                            <FirmDetail row={r} />
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
      <p className="text-[12px] text-muted">
        Score = replies (35, your reply rate pulled toward your {Math.round(overall * 100)}% average while there are few emails) + calls (25, full at 2) +
        referrals (25, full at 1) + chat grade (15, half when nothing is graded). Your stars are your own call and don&apos;t change the score.
      </p>
    </div>
  );
}

/** Which firms make up a tile, most people first, with the people (and what happened) under each. */
function ZoomPanel({ zoom, stats, onClose, onOpen }: { zoom: Zoom; stats: FirmStats[]; onClose: () => void; onOpen: (key: string) => void }) {
  const z = ZOOMS.find((x) => x.id === zoom)!;
  const firms = stats
    .map((s) => ({ s, people: s.contacts.filter(z.people) }))
    .filter((f) => f.people.length)
    .sort((a, b) => b.people.length - a.people.length || a.s.name.localeCompare(b.s.name));
  const max = Math.max(1, ...firms.map((f) => f.people.length));
  return (
    <Card>
      <CardHeader
        title={`${z.label}: ${firms.length}`}
        sub={`${firms.reduce((n, f) => n + f.people.length, 0)} people. Bars compare firms; click a firm to open it in the table.`}
        right={
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        }
      />
      {firms.length === 0 ? (
        <p className="px-4 pb-4 text-[12.5px] text-muted">None yet.</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
          {firms.map(({ s, people }) => (
            <li key={s.key} className="min-w-0 rounded-lg border border-line bg-panel p-3">
              <button type="button" onClick={() => onOpen(s.key)} className="flex w-full items-baseline justify-between gap-2 text-left">
                <span className="truncate font-medium text-ink hover:underline">{s.name}</span>
                <span className="num shrink-0 text-[12.5px] text-ink-2">
                  {people.length}
                  {zoom !== "emailed" && s.emailed > 0 && <span className="text-muted"> of {s.emailed} emailed</span>}
                </span>
              </button>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-track">
                <div className="h-full rounded-full bg-brass" style={{ width: `${(people.length / max) * 100}%` }} />
              </div>
              <ul className="mt-2 space-y-0.5 text-[12px] text-ink-2">
                {people.slice(0, 5).map((c) => (
                  <li key={c.id} className="truncate" title={z.line(c)}>
                    {z.line(c)}
                  </li>
                ))}
                {people.length > 5 && <li className="text-muted">+{people.length - 5} more</li>}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Stars({ value, onChange, firm }: { value?: number; onChange: (v: number | undefined) => void; firm: string }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <div className="flex items-center" role="group" aria-label={`Your rating of ${firm}`} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="p-0.5"
          aria-label={value === n ? `Clear rating (${n} star${n === 1 ? "" : "s"})` : `${n} star${n === 1 ? "" : "s"}`}
          aria-pressed={!!value && n <= value}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? undefined : n)}
        >
          <Star className={cn("size-4", n <= shown ? "fill-brass text-brass" : "text-line-2")} />
        </button>
      ))}
    </div>
  );
}

function FirmDetail({ row }: { row: Row }) {
  const people = [...row.contacts].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  const issues = [
    row.declined && `${row.declined} declined`,
    row.bounced && `${row.bounced} bounced`,
    row.left && `${row.left} left the firm`,
  ].filter(Boolean);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid gap-4">
        <div>
          <h4 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Why this score</h4>
          {row.result ? (
            <ul className="grid gap-2">
              {row.result.parts.map((p) => (
                <li key={p.id}>
                  <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="font-medium text-ink">{p.label}</span>
                    <span className="num text-ink-2">
                      {p.points} / {p.max}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-track">
                    <div className="h-full rounded-full bg-brass" style={{ width: `${(p.points / p.max) * 100}%` }} />
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-muted">{p.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted">Not started: nobody here has been emailed yet, so there&apos;s nothing to score.</p>
          )}
          {issues.length > 0 && <p className="mt-2 text-[12px] text-amber">{issues.join(" · ")}</p>}
        </div>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Your notes</span>
          <Textarea
            key={row.key}
            rows={4}
            defaultValue={row.rating?.notes ?? ""}
            placeholder="Culture, who was helpful, what they said about the group, where you stand…"
            onBlur={(e) => {
              const notes = e.target.value;
              if (notes !== (row.rating?.notes ?? "")) saveRating(row.key, { notes });
            }}
          />
          {row.rating?.updatedAt && <span className="mt-1 block text-[11px] text-muted">Saved {fmtDate(row.rating.updatedAt)}</span>}
        </label>
      </div>
      <div>
        <h4 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">People ({people.length})</h4>
        <ul className="divide-y divide-line rounded-md border border-line bg-panel">
          {people.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]">
              <div className="min-w-0">
                {talked(c) ? (
                  <Link href={`/prep?id=${encodeURIComponent(c.id)}`} className="font-medium text-navy hover:underline">
                    {c.name}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{c.name}</span>
                )}
                <div className="truncate text-[11.5px] text-muted">{[c.position, c.location, c.team].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {c.referral && <Badge tone="green">Referral</Badge>}
                {c.chats?.some((x) => x.grade) && <Badge tone="blue">Chat graded</Badge>}
                <StatusBadge status={c.status} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Replied or has a call: worth opening in coffee chat prep. */
const talked = (c: Contact) => !!c.repliedAt || !!c.call || ["replied", "call_scheduled", "done"].includes(c.status);

const ORDER: Record<Contact["status"], number> = { call_scheduled: 0, replied: 1, done: 2, followed_up: 3, sent: 4, drafted: 5, new: 6, ignored: 7 };
const order = (c: Contact) => ORDER[c.status];
