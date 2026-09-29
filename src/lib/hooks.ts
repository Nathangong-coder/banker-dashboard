import type { Contact, EmailHook, Settings } from "./types";

/**
 * Hooks: the sentence after "…pursuing investment banking." ({{my_pitch}}). It depends on who you're writing to:
 * the tech blurb fits Tech/TMT bankers, an energy one fits Energy, and everyone else gets none (Generic).
 * A contact can override the automatic choice (the Hook column on Email drafts).
 */
export const TECH_HOOK_TEXT =
  "Through my software development internship and starting my own tech startup, I've developed a strong interest in the tech sector.";

export const DEFAULT_HOOKS: EmailHook[] = [
  { id: "hook_tech", name: "Tech", text: TECH_HOOK_TEXT, teams: ["tech", "tmt", "technology", "software", "internet", "fintech"] },
  { id: "hook_energy", name: "Energy", text: "", teams: ["energy", "power", "utilities", "natural resources", "oil", "gas", "renewables", "infrastructure"] },
  { id: "hook_generic", name: "Generic (no hook)", text: "", teams: [], fallback: true },
];

export function hooksOf(s: Settings): EmailHook[] {
  return s.hooks?.length ? s.hooks : DEFAULT_HOOKS;
}

/** The hook a team gets automatically: first hook whose team words appear in the team, else the fallback. */
export function autoHook(team: string | undefined, s: Settings): EmailHook {
  const hooks = hooksOf(s);
  const t = ` ${(team ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const hit = team ? hooks.find((h) => !h.fallback && h.teams.some((w) => w.trim() && t.includes(` ${w.trim().toLowerCase()} `))) : undefined;
  return hit ?? hooks.find((h) => h.fallback) ?? hooks[hooks.length - 1];
}

/** The hook for this contact: their override, else the automatic one for their team. */
export function hookFor(c: Pick<Contact, "hookId" | "team">, s: Settings): EmailHook {
  return (c.hookId && hooksOf(s).find((h) => h.id === c.hookId)) || autoHook(c.team, s);
}
