import clsx, { type ClassValue } from "clsx";

export const cn = (...c: ClassValue[]) => clsx(c);

export function contactId(sheet: string, row: number) {
  return `s:${sheet}:${row}`;
}

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function splitName(full: string): { first: string; last: string } {
  const cleaned = full.replace(/\(.*?\)/g, "").replace(/,.*$/, "").trim().replace(/\s+/g, " ");
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts[parts.length - 1] };
}

export function normalizeLinkedin(url: string): string {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}/` : url.trim();
}

export function linkedinSlug(url: string): string {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}

export const DAY = 86_400_000;

export function daysBetween(a: string | Date, b: string | Date = new Date()) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DAY);
}

export function addDays(d: string | Date, n: number) {
  return new Date(new Date(d).getTime() + n * DAY);
}

export function fmtDate(d?: string | Date) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function relDays(d?: string | Date) {
  if (!d) return "—";
  const n = -daysBetween(d);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n}d` : `${-n}d ago`;
}

export function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Run async work over items with bounded concurrency, reporting progress. */
export async function pool<T, R>(
  items: T[],
  size: number,
  fn: (item: T, i: number) => Promise<R>,
  onProgress?: (done: number) => void,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
        onProgress?.(++done);
      }
    }),
  );
  return out;
}

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Best-guess corporate domains, used to scope Apollo/Hunter lookups. Editable per bank in the UI. */
export const BANK_DOMAINS: Record<string, string> = {
  "morgan stanley": "morganstanley.com",
  "goldman sachs": "gs.com",
  "jp morgan": "jpmorgan.com",
  "j.p. morgan": "jpmorgan.com",
  "bank of america": "bofa.com",
  citi: "citi.com",
  citigroup: "citi.com",
  ubs: "ubs.com",
  barclays: "barclays.com",
  "deutsche bank": "db.com",
  qatalyst: "qatalyst.com",
  evercore: "evercore.com",
  lazard: "lazard.com",
  "moelis & co.": "moelis.com",
  moelis: "moelis.com",
  "centerview partners": "centerview.com",
  "liontree partners": "liontree.com",
  "greenhill & co.": "greenhill.com",
  "raine group": "raine.com",
  "tidal partners": "tidalpartners.com",
  "perella weinberg partners": "pwpartners.com",
  "ft partners": "ftpartners.com",
  "pjt partners": "pjtpartners.com",
  blackstone: "blackstone.com",
  kkr: "kkr.com",
  "ares management": "aresmgmt.com",
  "bain capital": "baincapital.com",
  "vista equity partners": "vistaequitypartners.com",
  "insight partners": "insightpartners.com",
  jefferies: "jefferies.com",
  jeffries: "jefferies.com",
  "william blair": "williamblair.com",
  rothschild: "rothschildandco.com",
  guggenheim: "guggenheimpartners.com",
  "wells fargo": "wellsfargo.com",
  "piper sandler": "psc.com",
  "rbc capital markets": "rbccm.com",
  mizuho: "mizuhoamericas.com",
  "harris williams": "harriswilliams.com",
  nomura: "nomura.com",
  "houlihan lokey": "hl.com",
  "oppenheimer & co.": "opco.com",
  "cantor fitzgerald": "cantor.com",
  "raymond james": "raymondjames.com",
  baird: "rwbaird.com",
  "bmo capital markets": "bmo.com",
  "lincoln international": "lincolninternational.com",
};

export function guessDomain(bank: string): string | undefined {
  return BANK_DOMAINS[bank.toLowerCase().trim()];
}
