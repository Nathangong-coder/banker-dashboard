import type { Contact } from "./types";
import { tierRank, type CoverageRow } from "./coverage";
import { DESK_PRESETS, deskStatus, targetAppliesTo, targetLabel, teamMatches, type DeskStatus, type DeskTarget } from "./desks";
import { LIVE_STATUSES } from "./followups";
import { teamOf } from "./locationTeam";

export type InsightKind = "applied" | "uncovered" | "no_email" | "thin" | "quiet" | "unsorted" | "not_offered";

export interface Insight {
  kind: InsightKind;
  text: string;
  href?: string;
  cta?: string;
}

const enc = encodeURIComponent;
const names = (rows: CoverageRow[], n = 5) => rows.slice(0, n).map((r) => r.name).join(", ") + (rows.length > n ? ` (+${rows.length - n} more)` : "");
const byTier = (a: CoverageRow, b: CoverageRow) => tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name);

/**
 * "What am I missing": ranked, direct statements for the checked desks (or the preset desks when none are checked).
 * Order = priority: uncovered desks, people without emails, thin desks, gone quiet, unsorted teams, offices not offered.
 */
export function coverageInsights(rows: CoverageRow[], plan: DeskTarget[], contacts: Contact[], cap: number): Insight[] {
  const checked = plan.filter((t) => t.enabled);
  const desks: DeskTarget[] = checked.length ? checked : DESK_PRESETS.map((p, i) => ({ ...p, id: `preset-${i}`, enabled: true }));
  const shown = rows.filter((r) => r.bucket !== "hidden");
  const out: Record<InsightKind, Insight[]> = { applied: [], uncovered: [], no_email: [], thin: [], quiet: [], unsorted: [], not_offered: [] };

  // Applied to a summer analyst program, but nobody there has been emailed: networking is what moves an application.
  // Not for specialists outside your desks (applying to Leerink doesn't make it a Tech target).
  const appliedCold = shown.filter((r) => r.applied?.length && !(r.notOffered && r.specialty) && !r.allContacts.some((c) => !!c.sentAt || ["sent", "followed_up", "replied", "call_scheduled", "done"].includes(c.status))).sort(byTier);
  if (appliedCold.length)
    out.applied.push({
      kind: "applied",
      text: `You applied to ${names(appliedCold)} but haven't emailed anyone there yet.`,
      href: `/find?banks=${enc(appliedCold.slice(0, 8).map((r) => r.name).join("|"))}`,
      cta: "Find people",
    });

  for (const t of desks) {
    const label = targetLabel(t);
    const deskParam = enc(`${t.location}|${t.team}`);
    const list = shown
      .filter((r) => targetAppliesTo(t, r))
      .map((r) => ({ r, st: r.desks.find((d) => d.target.id === t.id) ?? deskStatus(t, r.allContacts, r.name, r.specialty?.teams) }));
    const where = (f: (st: DeskStatus) => boolean) => list.filter((x) => f(x.st)).map((x) => x.r).sort(byTier);

    const empty = where((st) => st.state === "empty");
    if (empty.length)
      out.uncovered.push({
        kind: "uncovered",
        text: `${label}: no one at ${names(empty)}.`,
        href: `/find?banks=${enc(empty.slice(0, 8).map((r) => r.name).join("|"))}&desk=${deskParam}`,
        cta: `Find ${t.team} people`,
      });

    const noEmail = list.filter((x) => x.st.state === "needs_email");
    const people = noEmail.reduce((n, x) => n + x.st.people.filter((p) => !p.email && p.status !== "ignored").length, 0);
    if (people)
      out.no_email.push({
        kind: "no_email",
        text: `${label}: ${people} ${people === 1 ? "person" : "people"} at ${noEmail.map((x) => x.r.name).slice(0, 4).join("/")}${noEmail.length > 4 ? "…" : ""} need${people === 1 ? "s" : ""} a verified email.`,
        href: `/sheet?view=contacts&filter=noemail`,
        cta: "Find emails",
      });

    const thin = where((st) => st.state !== "replied" && st.people.filter((p) => LIVE_STATUSES.has(p.status)).length === 1 && cap > 1);
    if (thin.length)
      out.thin.push({
        kind: "thin",
        text: `${label}: only 1 live person at ${names(thin)}. Room under the ${cap}-per-desk cap: add a second person.`,
        href: `/find?banks=${enc(thin.slice(0, 8).map((r) => r.name).join("|"))}&desk=${deskParam}`,
        cta: "Find a second person",
      });

    const notOffered = where((st) => st.state === "not_offered");
    // Two reasons: a specialist firm that doesn't cover this team, or an office with no summer seats for it.
    const specialist = notOffered.filter((r) => r.specialty && !r.specialty.teams.some((x) => teamMatches(t.team, x)));
    const office = notOffered.filter((r) => !specialist.includes(r));
    if (office.length)
      out.not_offered.push({
        kind: "not_offered",
        text: `${label}: ${names(office)} ${office.length === 1 ? "doesn't" : "don't"} hire summer analysts into ${t.location}. Shown as "not offered", not cold.`,
      });
    if (specialist.length)
      out.not_offered.push({
        kind: "not_offered",
        text: `${label}: ${specialist.map((r) => `${r.name} (${r.specialty!.teams.join("/")})`).slice(0, 6).join(", ")}${specialist.length > 6 ? "…" : ""} ${specialist.length === 1 ? "is a specialist" : "are specialists"} with no ${t.team} desk. Shown as "not offered", not cold.`,
      });
  }

  const quiet = shown.filter((r) => r.quiet).sort(byTier);
  if (quiet.length)
    out.quiet.push({
      kind: "quiet",
      text: `Gone quiet: ${names(quiet)}. Reached 3+ weeks ago, no reply, nobody live. Try someone new.`,
      href: `/find?banks=${enc(quiet.slice(0, 8).map((r) => r.name).join("|"))}`,
      cta: "Find new people",
    });

  const unsorted = contacts.filter((c) => c.status !== "ignored" && !teamOf(c)).length;
  if (unsorted)
    out.unsorted.push({
      kind: "unsorted",
      text: `${unsorted} contact${unsorted === 1 ? " has" : "s have"} no team. Their teams may hide coverage you already have.`,
      href: "/sheet?view=contacts&filter=noteam",
      cta: "Sort teams",
    });

  return [...out.applied, ...out.uncovered, ...out.no_email, ...out.thin, ...out.quiet, ...out.unsorted, ...out.not_offered];
}
