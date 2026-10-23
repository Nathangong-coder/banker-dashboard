import type { ReactNode } from "react";
import { Check, Clock, Mail, Star } from "lucide-react";
import { cn } from "@/lib/util";

/**
 * Drawn panels for the landing page. Mocks, not screenshots: a screenshot would show a real user's contacts and goes
 * stale on the next design pass. Every name here is made up. Static markup only (no store, no hooks), so /welcome
 * renders for crawlers without the dashboard's data.
 */
export type MockId = "sheet" | "coverage" | "firms" | "find" | "draft" | "smart" | "lab" | "followups" | "text" | "prep" | "log" | "info";

function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-panel p-4 text-ink shadow-sm", className)}>
      <div className="mb-3 text-[10.5px] font-medium tracking-[0.08em] text-muted uppercase">{title}</div>
      {children}
    </div>
  );
}

function Pill({ tone, children }: { tone: "green" | "blue" | "amber" | "brass" | "neutral" | "red"; children: ReactNode }) {
  const tones = {
    green: "bg-green-soft text-green",
    blue: "bg-blue-soft text-blue",
    amber: "bg-amber-soft text-amber",
    brass: "bg-brass-soft text-brass-ink",
    red: "bg-red-soft text-red",
    neutral: "bg-hover text-ink-2",
  };
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-medium whitespace-nowrap", tones[tone])}>{children}</span>;
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn("flex items-center justify-between gap-2 border-b border-line py-1.5 text-[12.5px] last:border-0", className)}>{children}</li>;
}

const Bar = ({ pct, className }: { pct: number; className?: string }) => (
  <span className="block h-1.5 w-full overflow-hidden rounded-full bg-track">
    <span className={cn("block h-full rounded-full bg-brass-strong", className)} style={{ width: `${pct}%` }} />
  </span>
);

function SheetMock() {
  const rows = [
    ["Alex Chen", "SF", "Tech", "Replied"],
    ["Priya Raman", "NY", "Generalist", "Sent"],
    ["Marcus Lee", "SF", "Tech", "Call scheduled"],
    ["Dana Ortiz", "LA", "Tech", "Pending"],
  ];
  return (
    <Panel title="Mizuho · Application tracker">
      <div className="overflow-hidden rounded-md border border-line text-[11.5px]">
        <div className="grid grid-cols-[1.4fr_.6fr_1fr_1.2fr] bg-subtle font-medium text-muted">
          {["Name", "Loc", "Team", "Status"].map((h) => (
            <span key={h} className="border-r border-line px-2 py-1 last:border-0">
              {h}
            </span>
          ))}
        </div>
        {rows.map((r, i) => (
          <div key={r[0]} className={cn("grid grid-cols-[1.4fr_.6fr_1fr_1.2fr] border-t border-line", i === 2 && "bg-green-soft")}>
            {r.map((v, j) => (
              <span key={j} className="truncate border-r border-line px-2 py-1 last:border-0">
                {v}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">1 change from the dashboard · saved to your .xlsx</p>
    </Panel>
  );
}

function CoverageMock() {
  const desks = [
    ["SF · Tech", 2, 2, "green"],
    ["NY · Generalist", 1, 2, "amber"],
    ["LA · Tech", 0, 2, "red"],
  ] as const;
  return (
    <Panel title="Bank coverage · 3 desks">
      <ul>
        {desks.map(([d, n, max, tone]) => (
          <Row key={d}>
            <span className="w-28 shrink-0">{d}</span>
            <Bar pct={(n / max) * 100} />
            <Pill tone={tone}>{n ? `${n} of ${max}` : "No one yet"}</Pill>
          </Row>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">LA · Tech: no one at 4 of your target banks →</p>
    </Panel>
  );
}

function FirmsMock() {
  const firms = [
    ["Evercore", 86],
    ["Houlihan Lokey", 74],
    ["Jefferies", 61],
    ["Piper Sandler", 48],
  ] as const;
  return (
    <Panel title="Firms · reply, call & referral score">
      <ul>
        {firms.map(([f, s]) => (
          <Row key={f}>
            <span className="w-28 shrink-0 truncate">{f}</span>
            <Bar pct={s} />
            <span className="w-7 text-right font-medium">{s}</span>
          </Row>
        ))}
      </ul>
    </Panel>
  );
}

function FindMock() {
  const people = [
    ["Jordan Park", "Analyst · Tech", "verified"],
    ["Sam Whitfield", "Associate · Tech", "verified"],
    ["Riley Novak", "MD · Head of Tech", "skip"],
  ] as const;
  return (
    <Panel title="Find people · Jefferies SF Tech">
      <ul>
        {people.map(([n, t, s]) => (
          <Row key={n}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{n}</span>
              <span className="block truncate text-[11px] text-muted">{t}</span>
            </span>
            {s === "verified" ? <Pill tone="green">✓ email verified</Pill> : <Pill tone="neutral">Senior · skipped</Pill>}
          </Row>
        ))}
      </ul>
    </Panel>
  );
}

function DraftMock() {
  return (
    <Panel title="Draft · Fellow Bruin Seeking to Connect">
      <div className="space-y-2 text-[12px] leading-relaxed text-ink-2">
        <p>Hi Jordan,</p>
        <p>
          I hope this email finds you well! My name is Sam, a UCLA student interested in investment banking.{" "}
          <span className="rounded bg-brass-soft px-0.5 text-brass-ink">Your path from Qualtrics to Jefferies&apos; tech group stood out to me</span>…
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Pill tone="brass">UCLA hook</Pill>
          <Pill tone="neutral">Resume attached</Pill>
          <Pill tone="blue">Tue 9:42 AM their time</Pill>
        </div>
      </div>
    </Panel>
  );
}

function SmartMock() {
  return (
    <Panel title="Smart mention · from your chat notes">
      <div className="rounded-md border border-line bg-subtle p-2.5 text-[11.5px] text-muted">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-ink">
          <Star className="size-3 fill-current text-amber" /> Chat with Chris Wong · 8/10
        </div>
        &ldquo;Great work/life balance, mentorship-based culture, small tech team…&rdquo;
      </div>
      <p className="mt-2.5 text-[12px] leading-relaxed text-ink-2">
        <span className="rounded bg-green-soft px-0.5 text-green">
          I recently spoke with Chris Wong, who told me about the mentorship-based culture on the team
        </span>
        , and I&apos;d love to learn more about tech at Mizuho from you.
      </p>
    </Panel>
  );
}

function LabMock() {
  return (
    <Panel title="Email lab · ask wording">
      {[
        ["A · \"love to have a call\"", 31, 42],
        ["B · \"appreciate the chance\"", 22, 40],
      ].map(([arm, pct, n]) => (
        <div key={arm as string} className="mb-2.5">
          <div className="mb-1 flex justify-between text-[12px]">
            <span>{arm}</span>
            <span className="text-muted">
              {pct}% of {n}
            </span>
          </div>
          <Bar pct={(pct as number) * 2} />
        </div>
      ))}
      <p className="text-[11px] text-muted">Not enough sends to call a winner yet.</p>
    </Panel>
  );
}

function FollowupsMock() {
  return (
    <Panel title="Follow-ups · scheduled">
      <ul>
        {[
          ["Priya Raman", "Follow-up #1", "Wed 9:17 AM ET"],
          ["Dana Ortiz", "First email", "Thu 10:03 AM PT"],
          ["Marcus Lee", "Replied", ""],
        ].map(([n, k, t]) => (
          <Row key={n}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{n}</span>
              <span className="block text-[11px] text-muted">{k}</span>
            </span>
            {t ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                <Clock className="size-3" />
                {t}
              </span>
            ) : (
              <Pill tone="green">Stopped · they replied</Pill>
            )}
          </Row>
        ))}
      </ul>
    </Panel>
  );
}

function TextMock() {
  return (
    <Panel title="WhatsApp · 9:00 PM">
      <div className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-green-soft p-3 text-[12px] leading-relaxed text-ink">
        <b>Tonight</b>
        <br />
        <b>Thank-you (call today)</b> (1)
        <br />• Marcus Lee
        <br />
        <b>Follow-up #1</b> (2)
        <br />• Priya Raman · • Jordan Park
        <br />
        <span className="text-muted">Log how it went → coverage…/log</span>
      </div>
    </Panel>
  );
}

function PrepMock() {
  return (
    <Panel title="Prep · Marcus Lee, Thu 4 PM">
      <ul className="space-y-1.5 text-[12px]">
        {[
          ["Common ground", "Both from Seattle; he tutored in college"],
          ["Ask", "How did the medtech deal shape your view of the group?"],
          ["Ask", "What made you move from Big 4 to banking?"],
        ].map(([k, v], i) => (
          <li key={i} className="flex gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-green" />
            <span>
              <span className="font-medium">{k}: </span>
              <span className="text-ink-2">{v}</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogMock() {
  return (
    <Panel title="Activity log">
      <ul>
        {[
          ["Marcus Lee", "Coffee chat", "B+ (86)", "green"],
          ["Chris Wong", "Phone call", "B (82)", "green"],
          ["Taylor Kim", "Coffee chat", "C+ (74)", "amber"],
        ].map(([n, k, g, tone]) => (
          <Row key={n}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{n}</span>
              <span className="block text-[11px] text-muted">{k} · thank-you sent</span>
            </span>
            <Pill tone={tone as "green" | "amber"}>{g}</Pill>
          </Row>
        ))}
      </ul>
    </Panel>
  );
}

function InfoMock() {
  return (
    <Panel title="Info session · 3 people to review">
      <ul>
        {["Morgan Ellis · Associate", "Jamie Brooks · Analyst", "Casey Tran · VP"].map((p) => (
          <Row key={p}>
            <span className="truncate">{p}</span>
            <Pill tone="brass">Confirm</Pill>
          </Row>
        ))}
      </ul>
      <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted">
        <Mail className="size-3" /> Thank-yous drafted · send tonight
      </p>
    </Panel>
  );
}

const MOCKS: Record<MockId, () => ReactNode> = {
  sheet: SheetMock,
  coverage: CoverageMock,
  firms: FirmsMock,
  find: FindMock,
  draft: DraftMock,
  smart: SmartMock,
  lab: LabMock,
  followups: FollowupsMock,
  text: TextMock,
  prep: PrepMock,
  log: LogMock,
  info: InfoMock,
};

export function Mock({ id }: { id: MockId }) {
  const M = MOCKS[id];
  return <M />;
}
