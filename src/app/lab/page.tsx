"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Beaker, Copy, FlaskConical, Layers, Plus, Sparkles, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { callApi } from "@/lib/api";
import { aiReady } from "@/lib/keys";
import { CONCISE_BASE, ORIGINAL_BASE } from "@/lib/defaults";
import { PLACEHOLDERS, fillPlaceholders } from "@/lib/template";
import { normalizeBody } from "@/lib/emailFormat";
import { applyBaseToTemplates, experimentResults, verdict, type Arm } from "@/lib/experiments";
import type { Contact, EmailBase, Template } from "@/lib/types";
import { cn, uid } from "@/lib/util";
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";

const hookBody = (hook: string) => `Hi {{first_name}},

{{base_opener}} {{base_intro}}

${hook}

{{base_ask}}

{{base_close}}`;

/** A fake recipient so previews read naturally even before the user has contacts. */
const SAMPLE: Contact = {
  id: "sample",
  name: "Jordan Lee",
  firstName: "Jordan",
  lastName: "Lee",
  bank: "Evercore",
  region: "SF",
  location: "SF",
  team: "Tech",
  position: "Associate",
  email: "",
  linkedin: "",
  comment: "",
  status: "new",
  source: "manual",
  followUps: 0,
  history: [],
};

/** Show [[AI: …]] slots as highlighted chips inside the preview. */
function Preview({ text }: { text: string }) {
  const parts = text.split(/(\[\[\s*AI:[\s\S]*?\]\])/g);
  return (
    <div className="whitespace-pre-wrap rounded-md border border-line bg-panel p-3 font-serif text-[14.5px] leading-relaxed">
      {parts.map((p, i) =>
        /^\[\[/.test(p) ? (
          <span key={i} className="rounded bg-blue-soft px-1 font-sans text-[12px] text-blue" title="Written per person by AI when drafting">
            {p.replace(/^\[\[\s*AI:\s*|\]\]$/g, "")}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </div>
  );
}

export default function LabPage() {
  const settings = useStore((s) => s.settings);
  const contacts = useStore((s) => s.contacts);
  const templates = useStore((s) => s.templates);
  const [sampleId, setSampleId] = useState("");
  const sample = contacts.find((c) => c.id === sampleId) ?? SAMPLE;
  const results = useMemo(() => experimentResults(contacts, settings, templates), [contacts, settings, templates]);

  return (
    <>
      <PageHeader
        title="Email lab"
        sub="One shared base under every template, A/B tests that alternate automatically, and an AI generator for new angles. Reply rates tell you what works."
        right={
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            Preview as
            <Select className="h-8 max-w-56" value={sampleId} onChange={(e) => setSampleId(e.target.value)} aria-label="Preview contact">
              <option value="">Sample (Jordan Lee, Evercore)</option>
              {contacts.slice(0, 300).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.bank}
                </option>
              ))}
            </Select>
          </label>
        }
      />
      <div className="space-y-6">
        <Bases sample={sample} />
        <Results results={results} />
        <Generator sample={sample} />
      </div>
    </>
  );
}

/* ---------------- bases ---------------- */

function Bases({ sample }: { sample: Contact }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const templates = useStore((s) => s.templates);
  const upsertTemplate = useStore((s) => s.upsertTemplate);
  const bases = settings.emailBases?.length ? settings.emailBases : [ORIGINAL_BASE, CONCISE_BASE];
  const [open, setOpen] = useState<string | null>(null);
  const setBases = (fn: (b: EmailBase[]) => EmailBase[]) => setSettings((s) => ({ ...s, emailBases: fn(s.emailBases?.length ? s.emailBases : bases) }));
  const active = bases.filter((b) => b.active);
  const initial = templates.filter((t) => t.kind === "initial");
  const usingBase = initial.filter((t) => /\{\{\s*base_/.test(t.body));

  const applyToTemplates = () => {
    const { changed, untouched } = applyBaseToTemplates(templates);
    changed.forEach(upsertTemplate);
    if (changed.length) toast.ok(`${changed.length} template${changed.length > 1 ? "s" : ""} now use the base.`);
    if (untouched.length)
      toast.info(`${untouched.join(", ")} didn't contain the original intro/ask/sign-off word for word. Add {{base_ask}} and {{base_close}} to ${untouched.length > 1 ? "them" : "it"} by hand.`);
    if (!changed.length && !untouched.length) toast.info("Every template already uses the base.");
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Layers className="size-4 text-brass" /> The base
          </span>
        }
        sub="The pleasantry, intro, ask and sign-off every first email shares. Templates only add their hook. Turn on two bases to A/B test them."
        right={
          <Button
            size="sm"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              const src = active[0] ?? bases[0];
              const copy = { ...src, id: uid("base"), name: `${src.name} (variant)`, active: false, notes: "" };
              setBases((b) => [...b, copy]);
              setOpen(copy.id);
            }}
          >
            New variant
          </Button>
        }
      />
      <div className="border-b border-line px-4 py-2.5 text-[12.5px] text-ink-2">
        <b className="num">{usingBase.length}</b> of <span className="num">{initial.length}</span> first-email templates use the base.
        {usingBase.length < initial.length && (
          <button className="ml-2 font-medium text-navy hover:underline" onClick={applyToTemplates}>
            Switch the rest over
          </button>
        )}
        {active.length > 1 && (
          <span className="ml-3 rounded bg-blue-soft px-1.5 py-0.5 text-blue">
            A/B test running: {active.map((b) => b.name).join(" vs ")}. New drafts alternate.
          </span>
        )}
      </div>
      <ul className="divide-y divide-line">
        {bases.map((b) => (
          <li key={b.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                checked={b.active}
                label={`Use ${b.name} for new drafts`}
                onChange={(v) => {
                  if (!v && active.length === 1 && b.active) return toast.info("Keep at least one base on.");
                  setBases((list) => list.map((x) => (x.id === b.id ? { ...x, active: v } : x)));
                }}
              />
              <span className="font-medium">{b.name}</span>
              {b.id === ORIGINAL_BASE.id && <Badge>control</Badge>}
              {b.active && <Badge tone="green">in use</Badge>}
              <span className="text-[12px] text-muted">{b.notes}</span>
              <div className="flex-1" />
              <button className="text-[12.5px] text-navy hover:underline" onClick={() => setOpen(open === b.id ? null : b.id)}>
                {open === b.id ? "Close" : "Edit & preview"}
              </button>
              {b.id !== ORIGINAL_BASE.id && (
                <button
                  aria-label={`Delete ${b.name}`}
                  className="rounded p-1 text-muted hover:text-red"
                  onClick={() => {
                    if (b.active && active.length === 1) return toast.info("Turn another base on first.");
                    setBases((list) => list.filter((x) => x.id !== b.id));
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            {open === b.id && <BaseEditor base={b} sample={sample} onChange={(n) => setBases((list) => list.map((x) => (x.id === b.id ? n : x)))} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BaseEditor({ base, sample, onChange }: { base: EmailBase; sample: Contact; onChange: (b: EmailBase) => void }) {
  const settings = useStore((s) => s.settings);
  const templates = useStore((s) => s.templates);
  const example = templates.find((t) => t.kind === "initial" && /\{\{\s*base_/.test(t.body) && t.id !== "tpl_standard") ?? templates.find((t) => t.kind === "initial");
  const preview = example ? normalizeBody(fillPlaceholders(example.body, sample, settings, {}, base)) : "";
  const words = preview.split(/\s+/).filter(Boolean).length;
  const field = (k: "opener" | "intro" | "ask" | "close", label: string, rows: number, hint?: string) => (
    <Field label={label} hint={hint}>
      <Textarea rows={rows} value={base[k]} onChange={(e) => onChange({ ...base, [k]: e.target.value })} />
    </Field>
  );
  return (
    <div className="mt-3 grid gap-4 lg:grid-cols-2">
      <div className="space-y-2.5">
        <Field label="Name">
          <Input value={base.name} onChange={(e) => onChange({ ...base, name: e.target.value })} />
        </Field>
        {field("opener", "Opener", 1, "Leave empty for none")}
        {field("intro", "Who you are", 3)}
        {field("ask", "The ask", 4)}
        {field("close", "Sign-off", 3)}
        <p className="text-[11.5px] text-muted">Placeholders like {"{{bank}}"}, {"{{position}}"} and {"{{my_pitch}}"} work here too.</p>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2 text-[11.5px] text-muted">
          Preview with “{example?.name}” <span className="num">· {words} words</span>
          {words > 150 && <span className="text-amber">long for a cold email; under ~125 reads best on a phone</span>}
        </div>
        <Preview text={preview} />
      </div>
    </div>
  );
}

/* ---------------- results ---------------- */

function RateBar({ a }: { a: Arm }) {
  return (
    <div className="relative h-2 w-40 rounded-full bg-[#ecebe4]" title={`95% range ${Math.round(a.lo * 100)}–${Math.round(a.hi * 100)}%`}>
      <div className="absolute h-2 rounded-full bg-green/25" style={{ left: `${a.lo * 100}%`, width: `${Math.max((a.hi - a.lo) * 100, 1)}%` }} />
      {a.sent > 0 && <div className="absolute top-[-2px] h-3 w-0.5 bg-green" style={{ left: `${a.rate * 100}%` }} />}
    </div>
  );
}

function ArmTable({ arms, empty }: { arms: Arm[]; empty: string }) {
  if (!arms.length) return <p className="px-4 py-3 text-[12.5px] text-muted">{empty}</p>;
  return (
    <table className="w-full text-[12.5px]">
      <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
        <tr>
          <th className="px-4 py-1.5 font-medium">Variant</th>
          <th className="px-2 py-1.5 text-right font-medium">Drafted</th>
          <th className="px-2 py-1.5 text-right font-medium">Sent</th>
          <th className="px-2 py-1.5 text-right font-medium">Replied</th>
          <th className="px-2 py-1.5 text-right font-medium">Rate</th>
          <th className="px-2 py-1.5 font-medium">Likely range</th>
          <th className="px-4 py-1.5 text-right font-medium">Days to reply</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {arms.map((a) => (
          <tr key={a.id}>
            <td className="px-4 py-1.5 font-medium">{a.label}</td>
            <td className="num px-2 text-right">{a.drafted}</td>
            <td className="num px-2 text-right">{a.sent}</td>
            <td className="num px-2 text-right text-green">{a.replied}</td>
            <td className="num px-2 text-right font-medium">{a.sent ? `${Math.round(a.rate * 100)}%` : "—"}</td>
            <td className="px-2">
              <RateBar a={a} />
            </td>
            <td className="num px-4 text-right text-muted">{a.medianDays ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Results({ results }: { results: ReturnType<typeof experimentResults> }) {
  const templates = useStore((s) => s.templates);
  const settings = useStore((s) => s.settings);
  const activeIds = (settings.emailBases ?? []).filter((b) => b.active).map((b) => b.id);
  const baseArms = results.byBase;
  const liveBases = baseArms.filter((a) => activeIds.includes(a.id));
  const groups = [...new Set(templates.map((t) => t.variantGroup).filter((g): g is string => !!g))]
    .map((g) => results.byTemplate.filter((a) => templates.find((t) => t.id === a.id)?.variantGroup === g))
    .filter((arms) => arms.length >= 2);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <FlaskConical className="size-4 text-brass" /> Results
          </span>
        }
        sub="Reply rate = replied ÷ sent. The bar shows the likely range; overlapping ranges mean it's too early to pick a winner."
      />
      <div className="border-b border-line px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted">Bases</div>
      <ArmTable arms={baseArms} empty="No tracked drafts yet. Every draft made from now on records its base and template." />
      {liveBases.length === 2 && <p className="px-4 pb-3 text-[12.5px] text-ink-2">{verdict(liveBases[0], liveBases[1])}</p>}
      {groups.map((arms) => (
        <div key={arms[0].id} className="border-t border-line">
          <div className="px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted">Template A/B: {arms.map((a) => a.label).join(" vs ")}</div>
          <ArmTable arms={arms} empty="" />
          <p className="px-4 pb-3 text-[12.5px] text-ink-2">{verdict(arms[0], arms[1])}</p>
        </div>
      ))}
      <div className="border-t border-line px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted">All templates</div>
      <ArmTable arms={results.byTemplate} empty="No first emails yet." />
      <p className="px-4 py-2.5 text-[11.5px] text-muted">
        Change one thing per test (subject, hook, or ask) so you know what made the difference. Replies are picked up by Gmail sync.
      </p>
    </Card>
  );
}

/* ---------------- generator ---------------- */

type Gen = { name: string; whenToUse: string; subject: string; hook: string; why: string };

function Generator({ sample }: { sample: Contact }) {
  const settings = useStore((s) => s.settings);
  const templates = useStore((s) => s.templates);
  const upsertTemplate = useStore((s) => s.upsertTemplate);
  const [angle, setAngle] = useState("");
  const [audience, setAudience] = useState("");
  const [variants, setVariants] = useState(2);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Gen[]>([]);
  const base = (settings.emailBases ?? []).find((b) => b.active) ?? ORIGINAL_BASE;

  const generate = async () => {
    if (!aiReady(settings)) return toast.err("Add an AI key in Settings first.");
    if (angle.trim().length < 10) return toast.err("Describe the angle in a sentence or two.");
    setBusy(true);
    try {
      const p = settings.profile;
      const examples = templates
        .filter((t) => t.kind === "initial" && /\{\{\s*base_/.test(t.body))
        .map((t) => t.body.split(/\n\s*\n/).find((para) => !/\{\{\s*base_|^Hi /.test(para.trim())) ?? "")
        .filter(Boolean)
        .slice(0, 3);
      const r = await callApi<{ templates: Gen[] }>(
        "/api/templates/generate",
        {
          angle: angle.trim(),
          audience: audience.trim(),
          me: { name: p.name, school: p.school, year: p.year, major: p.major, hometown: p.hometown, club: p.club, pitch: p.pitch },
          base: { opener: base.opener, intro: base.intro, ask: base.ask, close: base.close },
          examples,
          placeholders: PLACEHOLDERS.filter((x) => !x.key.startsWith("base_")),
          variants,
        },
        settings,
      );
      setOut(r.templates);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toTemplate = (g: Gen, group?: string): Template => ({
    id: uid("tpl"),
    name: g.name,
    whenToUse: g.whenToUse,
    subject: g.subject,
    body: hookBody(g.hook),
    attachResume: true,
    kind: "initial",
    experimental: true,
    variantGroup: group,
  });

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Beaker className="size-4 text-brass" /> New template from an angle <Badge tone="brass">experimental</Badge>
          </span>
        }
        sub="Describe a connection you share with a group of bankers. AI writes the hook and subject around your base; you review before saving."
      />
      <div className="grid gap-3 p-4 md:grid-cols-[1fr_260px]">
        <Field label="The angle">
          <Textarea
            rows={3}
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            placeholder="I grew up in Washington state. Reach out to people who went to UW (University of Washington) and ask what their experience was like there and how they made it from Seattle into banking."
          />
        </Field>
        <div className="space-y-3">
          <Field label="Who it's for (optional)">
            <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="UW alumni in banking" />
          </Field>
          <Field label="Versions">
            <Select className="w-full" value={variants} onChange={(e) => setVariants(Number(e.target.value))}>
              <option value={1}>1 template</option>
              <option value={2}>2 versions to A/B test</option>
              <option value={3}>3 versions to A/B test</option>
            </Select>
          </Field>
          <Button variant="brass" className="w-full" loading={busy} icon={<Sparkles className="size-3.5" />} onClick={generate}>
            Generate
          </Button>
        </div>
      </div>

      {out.length > 0 && (
        <div className="space-y-4 border-t border-line p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {out.map((g, i) => (
              <GenCard
                key={i}
                g={g}
                sample={sample}
                onChange={(n) => setOut((list) => list.map((x, j) => (j === i ? n : x)))}
                onSave={() => {
                  upsertTemplate(toTemplate(g));
                  toast.ok(`Saved “${g.name}” as an experimental template. Auto-assign uses its “when to use”.`);
                }}
              />
            ))}
          </div>
          {out.length > 1 && (
            <div className="flex items-center gap-3 rounded-md bg-blue-soft/50 px-3 py-2 text-[12.5px]">
              <span>Save all {out.length} as one A/B test: contacts who fit get them in rotation, and the Results table compares them.</span>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="primary"
                icon={<Copy className="size-3.5" />}
                onClick={() => {
                  const group = uid("ab");
                  out.forEach((g, i) => upsertTemplate({ ...toTemplate(g, group), name: `${g.name} (${String.fromCharCode(65 + i)})` }));
                  toast.ok(`Saved ${out.length} variants as an A/B test.`);
                  setOut([]);
                }}
              >
                Save as A/B test
              </Button>
            </div>
          )}
        </div>
      )}
      {!out.length && (
        <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
          Saved templates show up in{" "}
          <Link href="/drafts" className="text-navy hover:underline">
            Email drafts
          </Link>{" "}
          with an “experiment” badge. Per-person facts the AI can&apos;t know yet appear as [[AI: …]] slots and get filled when drafting.
        </p>
      )}
    </Card>
  );
}

function GenCard({ g, sample, onChange, onSave }: { g: Gen; sample: Contact; onChange: (g: Gen) => void; onSave: () => void }) {
  const settings = useStore((s) => s.settings);
  const base = (settings.emailBases ?? []).find((b) => b.active) ?? ORIGINAL_BASE;
  const body = normalizeBody(fillPlaceholders(hookBody(g.hook), sample, settings, {}, base));
  const subject = fillPlaceholders(g.subject, sample, settings, {}, base);
  return (
    <div className={cn("space-y-2 rounded-lg border border-line p-3")}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name">
          <Input value={g.name} onChange={(e) => onChange({ ...g, name: e.target.value })} />
        </Field>
        <Field label="Subject">
          <Input value={g.subject} onChange={(e) => onChange({ ...g, subject: e.target.value })} />
        </Field>
      </div>
      <Field label="When to use (auto-assign reads this)">
        <Input value={g.whenToUse} onChange={(e) => onChange({ ...g, whenToUse: e.target.value })} />
      </Field>
      <Field label="Hook">
        <Textarea rows={4} value={g.hook} onChange={(e) => onChange({ ...g, hook: e.target.value })} />
      </Field>
      <p className="text-[11.5px] text-muted">{g.why}</p>
      <div className="text-[11.5px] text-muted">Subject: {subject}</div>
      <Preview text={body} />
      <div className="flex justify-end">
        <Button size="sm" variant="primary" onClick={onSave}>
          Save as template
        </Button>
      </div>
    </div>
  );
}
