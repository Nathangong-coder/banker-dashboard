/**
 * Turn a templates document (Word .docx, a Google Doc exported as .docx, or plain text) into email templates.
 *
 * Deterministic first: document structure (Google Docs tab titles / headings → sections, all-bold lines →
 * sub-sections), the greeting line ("Hi …") marks where an email starts, the line above it is the subject,
 * and ALL-CAPS blanks (NAME, FIRM, POSITION…) are mapped to placeholders by position and a known-word list.
 * Every substitution is recorded so the review screen can show exactly what changed. An optional AI pass
 * only names/describes templates and resolves blanks this parser couldn't; it is not allowed to reword.
 */
import JSZip from "jszip";
import type { Template } from "./types";

export type BlockKind = "title" | "heading" | "bold" | "text";
export interface Block {
  kind: BlockKind;
  text: string;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

/** Read paragraphs + their role from a .docx (works in the browser and in Node). */
export async function docxToBlocks(data: ArrayBuffer | Uint8Array): Promise<Block[]> {
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("That doesn't look like a Word document (no word/document.xml).");
  const blocks: Block[] = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const runs = [...p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map((m) => m[0]);
    const pieces = runs.map((r) => ({
      text: [...r.matchAll(/<w:(t|tab|br)(?: [^>]*)?(?:\/>|>([^<]*)<\/w:t>)/g)]
        .map((m) => (m[1] === "t" ? decode(m[2] ?? "") : m[1] === "tab" ? "\t" : "\n"))
        .join(""),
      bold: /<w:b(?: w:val="(?:1|true)")?\/>/.test(r) || /<w:b\s*\/>/.test(r),
    }));
    const text = pieces.map((x) => x.text).join("").replace(/ /g, " ");
    const visible = pieces.filter((x) => x.text.trim());
    const allBold = visible.length > 0 && visible.every((x) => x.bold);
    const kind: BlockKind = /^Title$/i.test(style)
      ? "title"
      : /^(Heading|Subtitle)/i.test(style)
        ? "heading"
        : allBold && text.trim().length < 80
          ? "bold"
          : "text";
    blocks.push({ kind, text });
  }
  return blocks;
}

/** Plain text / markdown: "# Heading", "## Sub", or short ALL-CAPS lines act as section markers. */
export function textToBlocks(text: string): Block[] {
  return text.split(/\r?\n/).map((line) => {
    const t = line.trimEnd();
    if (/^#\s+/.test(t)) return { kind: "title" as const, text: t.replace(/^#\s+/, "") };
    if (/^#{2,}\s+/.test(t)) return { kind: "heading" as const, text: t.replace(/^#+\s+/, "") };
    if (/^\*\*.+\*\*$/.test(t.trim())) return { kind: "bold" as const, text: t.trim().slice(2, -2) };
    if (t.trim().length > 3 && t.trim().length < 60 && t === t.toUpperCase() && /[A-Z]{3}/.test(t)) return { kind: "bold" as const, text: t.trim() };
    return { kind: "text" as const, text: t };
  });
}

/* ------------------------------------------------------------------ */

export interface Substitution {
  from: string;
  to: string;
  why: string;
}

export interface ImportCandidate {
  key: string;
  tab: string;
  heading: string;
  name: string;
  whenToUse: string;
  kind: Template["kind"];
  step?: number;
  subject: string;
  body: string;
  attachResume: boolean;
  substitutions: Substitution[];
  /** ALL-CAPS words we couldn't map with confidence; converted to [[AI: …]] slots and flagged for review. */
  unknownBlanks: string[];
}

export interface ImportResult {
  candidates: ImportCandidate[];
  skipped: { where: string; reason: string }[];
  notes: string[];
}

const GREETING = /^\s*(hi|hello|hey|dear|good (morning|afternoon|evening))\b/i;
const SIGNOFF = /^\s*(best|sincerely|regards|kind regards|warm regards|thanks|thank you|cheers|all the best|best regards|respectfully)[,!.]?\s*$/i;
const NOTES_HEADING = /^(reminders?|notes?|tips?)\b/i;

/** Acronyms that are real words in these emails, never blanks. */
const KEEP_CAPS = new Set(
  "UCLA USC UC LA NY NYC SF MBA CFA MD VP SVP EVP IB M&A TMT PE VC CA WA US USA II III AI ML CEO CFO COO HBS NYU MIT LSE ASAP OK PM AM TA GPA SAT ACT".split(" "),
);

/** Known blank words → placeholder. NAME is resolved by position (see below). */
const BLANKS: [RegExp, string, string][] = [
  [/\b(FIRM|BANK|COMPANY)\b/g, "{{bank}}", "the contact's bank"],
  [/\b(POSITION|TITLE|ROLE)\b/g, "{{position}}", "the contact's title"],
  [/\bX HIGH SCHOOL\b|\bHIGH SCHOOL\b(?= [a-z,])/g, "[[AI: the contact's high school, from their profile or my notes]]", "the contact's high school"],
  [/\bSCHOOL\b/g, "{{their_school}}", "the contact's school"],
  [/\bHOMETOWN\b/g, "{{my_hometown}}", "your hometown (Settings → profile)"],
  [/\bCLUB\b/g, "{{my_club}}", "your club (Settings → profile)"],
  [/\bCITY\b/g, "{{their_city}}", "the contact's city (from SF/NY)"],
  [/\bMAJOR\b/g, "{{my_major}}", "your major"],
  [/\bGROUP\b|\bTEAM\b/g, "{{team}}", "the contact's team"],
];

type MyDetail = [value: string, placeholder: string, why: string];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function outsideSlots(line: string, fn: (seg: string) => string) {
  return line
    .split(/(\[\[[\s\S]*?\]\])/)
    .map((part) => (part.startsWith("[[") ? part : fn(part)))
    .join("");
}

/** The sender's own details (from Settings) that should become placeholders, longest first. */
function myDetails(p?: ImportProfile): MyDetail[] {
  if (!p) return [];
  const list: [string | undefined, string, string][] = [
    [p.pitch, "{{my_pitch}}", "your background line (Settings → profile)"],
    [p.major, "{{my_major}}", "your major"],
    [p.club, "{{my_club}}", "your club"],
    [p.schoolNickname, "{{my_school_nickname}}", "your school nickname"],
    [p.hometown, "{{my_hometown}}", "your hometown"],
    [p.school, "{{my_school}}", "your school"],
  ];
  return list
    .filter((d): d is MyDetail => !!d[0] && d[0].trim().length >= 2)
    .map(([v, to, why]): MyDetail => [v.trim(), to, why])
    .sort((a, b) => b[0].length - a[0].length);
}

export interface ImportProfile {
  name?: string;
  school?: string;
  major?: string;
  pitch?: string;
  club?: string;
  schoolNickname?: string;
  hometown?: string;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function titleCase(s: string) {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Uc|Usc|Ucla|La|Ny|Vp|Md)\b/g, (m) => m.toUpperCase())
    .replace(/(?!^)\b(And|Of|The|In|From|To|For|At)\b/g, (m) => m.toLowerCase());
}

/** Heuristic name + "when to use" from a section heading; the AI pass may refine the description. */
function describe(heading: string, tab: string): { name: string; whenToUse: string; kind: Template["kind"]; step?: number } {
  const h = `${heading} ${tab}`.toLowerCase();
  if (/follow/.test(h)) {
    const step = /second|2nd|\b2\b|final|last/.test(heading.toLowerCase()) ? 2 : /third|3rd|\b3\b/.test(heading.toLowerCase()) ? 3 : 1;
    return { name: titleCase(heading), whenToUse: `Follow-up #${step} when there's no reply.`, kind: "follow_up", step };
  }
  const rules: [RegExp, string][] = [
    [/vice president|managing director|\bvp\b|\bmd\b|senior|and above/, "Senior bankers (VP, Director, MD and above) with no specific shared connection."],
    [/anderson|business school|mba/, "Contact went to my university's business/grad school (e.g. UCLA Anderson)."],
    [/non.?target/, "Contact went to a non-target school."],
    [/\busc\b/, "Contact went to USC."],
    [/university of california|\buc alum|\buc\b/, "Contact went to another University of California campus."],
    [/\bla uni|la university|same city/, "Contact went to another college in my school's city."],
    [/relevant.*hometown|high school/, "Contact went to a high school in my hometown area."],
    [/hometown/, "Contact is from my hometown / home state."],
    [/club/, "Contact was in the same student club as me."],
    [/major/, "Contact studied the same major as me."],
    [/ucla|alum|bruin/, "Contact went to the same university as me."],
    [/standard|default|general/, "Default for analysts/associates with no specific shared connection."],
  ];
  const hit = rules.find(([re]) => re.test(h));
  return { name: titleCase(heading), whenToUse: hit ? hit[1] : `Use for: ${heading}`, kind: "initial" };
}

/**
 * Replace blanks in one email. Handles the NAME ambiguity by position: in the greeting it's the contact,
 * after "my name is" or as the sign-off it's the sender.
 */
function substitute(lines: string[], senderFirstName: string, subs: Substitution[], unknown: Set<string>, mine: MyDetail[] = []): string[] {
  const out = [...lines];
  const note = (from: string, to: string, why: string) => {
    if (!subs.some((s) => s.from === from && s.to === to)) subs.push({ from, to, why });
  };
  const lastText = [...out.keys()].reverse().find((i) => out[i].trim());

  out.forEach((line, i) => {
    let l = line;
    if (GREETING.test(l)) {
      l = l.replace(/\bNAME\b/, () => (note("NAME (greeting)", "{{first_name}}", "the contact's first name"), "{{first_name}}"));
    }
    l = l.replace(/\b(my name is)\s+(NAME\b|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)(?=[,.\s])/gi, (m, pre: string, who: string) => {
      if (who !== "NAME" && senderFirstName && who.split(" ")[0].toLowerCase() !== senderFirstName.toLowerCase() && who !== who.toUpperCase())
        return m; // someone else's name; leave it
      note(who === "NAME" ? "NAME (my name is …)" : `"${who}" (your name)`, "{{my_name}}", "your name (Settings → profile)");
      return `${pre} {{my_name}}`;
    });
    if (i === lastText && /^\s*(NAME|[A-Z][a-z]+(?: [A-Z][a-z]+)?)\s*$/.test(l) && !SIGNOFF.test(l)) {
      const who = l.trim();
      if (who === "NAME" || !senderFirstName || who.split(" ")[0].toLowerCase() === senderFirstName.toLowerCase()) {
        note(who === "NAME" ? "NAME (sign-off)" : `"${who}" (sign-off)`, "{{my_name}}", "your name");
        l = l.replace(who, "{{my_name}}");
      }
    }
    // Bracketed author notes → AI instructions (their wording is kept verbatim as the instruction).
    l = l.replace(/\[(?!\[)([^\]]{3,})\](?!\])/g, (m, inner: string) => {
      const to = `[[AI: ${inner.trim()}]]`;
      note(m, to, "author note → AI fills it per contact");
      return to;
    });
    // Everything below only touches text outside [[AI: …]] slots.
    l = outsideSlots(l, (seg) => {
      for (const [re, to, why] of BLANKS) seg = seg.replace(re, (m) => (note(m, to, why), to));
      for (const [value, to, why] of mine) {
        seg = seg.replace(new RegExp(`(?<![\\w{])${escapeRe(value)}(?![\\w}])`, "g"), (m) => (note(`"${m}" (your details)`, to, why), to));
      }
      // Any leftover blank-looking ALL-CAPS word(s).
      return seg.replace(/\b[A-Z][A-Z&']{2,}(?:\s[A-Z][A-Z&']{2,})*\b/g, (m) => {
        if (m.split(/\s/).every((w) => KEEP_CAPS.has(w))) return m;
        unknown.add(m);
        const to = `[[AI: fill in "${m}" for this contact]]`;
        note(m, to, "unrecognized blank → AI fills it; please review");
        return to;
      });
    });
    if (l.includes("NAME")) {
      unknown.add("NAME");
      l = l.replace(/\bNAME\b/g, "{{first_name}}");
      note("NAME (ambiguous)", "{{first_name}}", "assumed contact's name; please review");
    }
    out[i] = l;
  });
  return out;
}

export function parseTemplateBlocks(blocks: Block[], opts: { senderName?: string; generalize?: ImportProfile } = {}): ImportResult {
  const senderFirst = (opts.senderName ?? opts.generalize?.name ?? "").trim().split(/\s+/)[0] ?? "";
  const mine = myDetails(opts.generalize);
  const result: ImportResult = { candidates: [], skipped: [], notes: [] };

  // 1) Group into sections: tab/title → optional bold/heading sub-sections.
  type Section = { tab: string; heading: string; lines: string[] };
  const sections: Section[] = [];
  let tab = "";
  let cur: Section | null = null;
  let inNotes = false;
  for (const b of blocks) {
    const t = b.text.trim();
    if (b.kind === "title") {
      tab = t;
      cur = { tab, heading: tab, lines: [] };
      sections.push(cur);
      inNotes = false;
      continue;
    }
    if (inNotes && b.kind === "bold" && t) {
      result.notes.push(t);
      continue;
    }
    if ((b.kind === "bold" || b.kind === "heading") && t) {
      // A bold line inside an email that looks like a sign-off name is content, not a new section.
      const insideEmail = !!cur && cur.lines.some((l) => GREETING.test(l)) && /^(NAME|[A-Z][a-z]+(?: [A-Z][a-z]+)?)$/.test(t);
      if (!insideEmail) {
        if (NOTES_HEADING.test(t)) {
          inNotes = true;
          result.notes.push(t);
          continue;
        }
        inNotes = false;
        cur = { tab, heading: t, lines: [] };
        sections.push(cur);
        continue;
      }
    }
    if (inNotes) {
      if (t) result.notes.push(t);
      continue;
    }
    if (!cur) {
      cur = { tab, heading: tab || "Untitled", lines: [] };
      sections.push(cur);
    }
    cur.lines.push(...b.text.split("\n"));
  }

  // 2) Each section with a greeting line becomes a template.
  const seen = new Map<string, number>();
  for (const s of sections) {
    const where = s.tab && s.tab !== s.heading ? `${s.tab} → ${s.heading}` : s.heading;
    const g = s.lines.findIndex((l) => GREETING.test(l));
    if (g < 0) {
      const isTabHeader = s.heading === s.tab && sections.some((x) => x !== s && x.tab === s.tab);
      if (s.lines.some((l) => l.trim())) result.skipped.push({ where, reason: "No greeting line (Hi/Dear …), so it doesn't look like a finished email" });
      else if (!isTabHeader) result.skipped.push({ where, reason: "Empty section" });
      continue;
    }
    const subjectLine = s.lines.slice(0, g).map((l) => l.trim()).filter(Boolean).pop() ?? "";
    let bodyLines = s.lines.slice(g);
    while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    // Collapse runs of 2+ blank lines to one.
    bodyLines = bodyLines.filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()));

    const subs: Substitution[] = [];
    const unknown = new Set<string>();
    const meta = describe(s.heading, s.tab);
    const body = substitute(bodyLines, senderFirst, subs, unknown, mine).join("\n").replace(/[ \t]+$/gm, "");
    let subject = subjectLine ? substitute([subjectLine], senderFirst, subs, unknown, mine)[0].trim() : "";
    if (!subject && meta.kind === "follow_up") subject = "Re: {{original_subject}}";

    const baseKey = slug(where) || "template";
    const n = (seen.get(baseKey) ?? 0) + 1;
    seen.set(baseKey, n);
    result.candidates.push({
      key: n > 1 ? `${baseKey}-${n}` : baseKey,
      tab: s.tab,
      heading: s.heading,
      ...meta,
      subject,
      body,
      attachResume: meta.kind === "initial" && /resume|cv/i.test(body),
      substitutions: subs,
      unknownBlanks: [...unknown],
    });
  }
  return result;
}

/** Words of a template with placeholders/slots removed, for checking an AI pass didn't reword anything. */
export function wordSkeleton(t: string) {
  return t
    .replace(/\{\{\s*\w+\s*\}\}/g, " ")
    .replace(/\[\[[\s\S]*?\]\]/g, " ")
    .replace(/\b[A-Z][A-Z&']{2,}\b/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** True if `after` keeps every original word in order (it may only have swapped blanks for placeholders). */
export function sameWording(before: string, after: string) {
  const a = wordSkeleton(before);
  const b = wordSkeleton(after);
  if (Math.abs(a.length - b.length) > Math.max(3, a.length * 0.03)) return false;
  let j = 0;
  let matched = 0;
  for (const w of a) {
    const k = b.indexOf(w, j);
    if (k >= 0 && k - j < 4) {
      matched++;
      j = k + 1;
    }
  }
  return matched >= a.length * 0.97;
}

export function toTemplate(c: ImportCandidate, id: string): Template {
  return {
    id,
    name: c.name,
    whenToUse: c.whenToUse,
    kind: c.kind,
    step: c.step,
    subject: c.subject,
    body: c.body,
    attachResume: c.attachResume,
  };
}
