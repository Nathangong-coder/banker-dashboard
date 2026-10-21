/**
 * The coffee-chat grading rubric (api/prep/grade): areas, their weight in the overall score, and what a 5 / 3 / 1 looks
 * like so scores mean the same thing every time. Editable in admin mode (/log ⋯ → Grading rubric, `settings.prep.rubric`);
 * the overall score is computed from it here, never by the model. Shared by the route and the editor (no server code).
 */
export interface RubricArea {
  area: string;
  /** Relative weight in the overall score (they don't have to add up to 100). */
  weight: number;
  /** What a 5, a 3 and a 1 look like. */
  anchors: string;
}

export const RUBRIC_LIMITS = { minAreas: 2, maxAreas: 12, area: 60, anchors: 600, maxWeight: 100 } as const;

export const DEFAULT_RUBRIC: RubricArea[] = [
  {
    area: "Connection & energy",
    weight: 25,
    anchors:
      "How the call felt and how the banker responded. 5 = they clearly enjoyed it: laughing, banter, telling stories unprompted, " +
      "the call ran over, they offered help or another call. 3 = polite and pleasant but transactional. 1 = awkward, flat or cut short.",
  },
  {
    area: "Personal rapport & common ground",
    weight: 20,
    anchors:
      "Found and built on shared ground (school, hometown, interests, background) and let the conversation get personal. Long personal " +
      "stretches the banker engages in raise this score; they are never time wasted. 5 = a real personal connection. 3 = a little. 1 = none.",
  },
  {
    area: "Listening & follow-ups",
    weight: 15,
    anchors: "5 = follow-ups built on what they just said and the conversation flowed. 3 = some follow-ups, some list-reading. 1 = read questions off a list.",
  },
  {
    area: "Question quality & preparation",
    weight: 15,
    anchors: "Specific questions showing they knew the firm, group and this banker's path. 5 = researched and insightful. 3 = generic but fine. 1 = Google-able or none.",
  },
  {
    area: "Opening & story",
    weight: 10,
    anchors: "The intro and the student's own story: clear, natural, tailored to this banker. 5 = memorable. 3 = fine. 1 = rambling or missing.",
  },
  {
    area: "Asks & next steps",
    weight: 10,
    anchors: "Asked for advice, who else to talk to or a next step at the right moment, without being pushy. 5 = natural ask that landed. 3 = vague. 1 = none, or pushy.",
  },
  {
    area: "Close",
    weight: 5,
    anchors:
      "Wrapped up warmly, thanked them, confirmed next steps. Only mark down for time when the BANKER signalled they had to go and the " +
      "student kept going; a call that runs long because the banker is enjoying it is a good sign.",
  },
];

/** A usable rubric: blank areas dropped, weights clamped; falls back to the default when too few areas are left. */
export function cleanRubric(r: RubricArea[] | undefined): RubricArea[] {
  const out = (r ?? [])
    .map((a) => ({ area: a.area.trim().slice(0, RUBRIC_LIMITS.area), weight: Math.max(0, Math.min(RUBRIC_LIMITS.maxWeight, Math.round(a.weight) || 0)), anchors: a.anchors.trim().slice(0, RUBRIC_LIMITS.anchors) }))
    .filter((a) => a.area)
    .slice(0, RUBRIC_LIMITS.maxAreas);
  return out.length >= RUBRIC_LIMITS.minAreas && out.some((a) => a.weight > 0) ? out : DEFAULT_RUBRIC;
}

/** 1-5 per area → 0-100, weighted: all 3s = 71 (a forgettable call is a C-), all 4s = 84 (B), all 5s = 98. */
export function overallScore(rubric: RubricArea[], scores: number[]) {
  const total = rubric.reduce((n, a) => n + a.weight, 0) || 1;
  const avg = rubric.reduce((n, a, i) => n + a.weight * (scores[i] ?? 3), 0) / total;
  return Math.round(43 + ((avg - 1) / 4) * 55);
}

export function letterOf(score: number) {
  const bands: [number, string][] = [[93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"], [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [60, "D"]];
  return bands.find(([min]) => score >= min)?.[1] ?? "F";
}
