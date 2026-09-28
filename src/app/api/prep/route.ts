import { generateText, Output } from "ai";
import { z } from "zod";
import { aiJson, aiErrorResponse, withAi } from "@/lib/server/ai";
import { keysFrom } from "@/lib/server/keys";
import { webSearch } from "@/lib/server/search";

export const maxDuration = 120;

const Body = z.object({
  contact: z.object({
    name: z.string().min(1).max(120),
    bank: z.string().max(120),
    position: z.string().max(200),
    location: z.string().max(120),
    team: z.string().max(120),
    school: z.string().max(200),
    notes: z.string().max(2000),
    status: z.string().max(40),
    history: z.string().max(1500),
  }),
  /** Their LinkedIn profile as the user captured or pasted it. */
  profileText: z.string().max(15000),
  me: z.record(z.string(), z.string().max(600)),
  /** Last email the user sent them, if any (what the call will pick up from). */
  lastEmail: z.string().max(4000),
  searchWeb: z.boolean(),
});

const Prep = z.object({
  brief: z.string().describe("3-4 sentences: who they are, how they got here, what they likely work on now. Only from the facts given."),
  path: z
    .array(z.object({ role: z.string(), org: z.string(), when: z.string().describe("e.g. 2022 – now; empty if unknown") }))
    .describe("Their roles and schools, most recent first, ONLY from the profile text. Empty if there is no profile text."),
  commonGround: z.array(z.string()).describe("0-4 genuine overlaps with the student (school, hometown, clubs, interests), each citing the evidence. Empty if none."),
  intro: z.string().describe("The student's 30-second self-introduction for this call, first person, 3-4 sentences, angled at this person."),
  tailored: z
    .array(z.object({ question: z.string(), why: z.string().describe("One short line: which fact this question comes from") }))
    .min(3)
    .max(5),
});

export async function POST(req: Request) {
  try {
    const input = Body.parse(await req.json());
    const { contact } = input;

    // Optional public context: bank bio pages, news, deal announcements. LinkedIn itself is excluded.
    const sources: { title: string; link: string; snippet: string }[] = [];
    const warnings: string[] = [];
    if (input.searchWeb) {
      const serper = keysFrom(req, "serper");
      const brave = keysFrom(req, "brave");
      if (serper.length || brave.length) {
        try {
          const q = `"${contact.name}" ${contact.bank ? `"${contact.bank}"` : ""} -site:linkedin.com`.trim();
          const results = await webSearch(serper, brave, q, 8, warnings);
          for (const r of results.slice(0, 6)) if (r.link && r.title) sources.push({ title: r.title, link: r.link, snippet: (r.snippet ?? "").slice(0, 400) });
        } catch (e) {
          warnings.push(`Web search skipped: ${(e as Error).message}`);
        }
      } else warnings.push("Web search skipped: add a Serper or Brave key in Settings.");
    }

    const { output } = await withAi(req, (model, opts) =>
      generateText({
        ...opts,
        model,
        output: Output.object({ schema: Prep }),
        system:
          "You prepare a college student for a coffee chat (often a surprise phone call) with an investment banker they cold-emailed. " +
          "Use ONLY the facts provided: the dashboard record, the LinkedIn profile text the student captured, the student's own profile, " +
          "their last email, and the web results. Never invent employers, schools, deals, teams or dates. Web results may be about a different " +
          "person with the same name: use one only if the employer matches. " +
          "Tailored questions must be specific to this person (their path, group, a switch they made, their school, a deal or topic in the " +
          "sources) and must not repeat these general questions the student already has: " +
          "career journey, typical week, most interesting deal, what makes analysts stand out, advice for recruiting. " +
          "Questions should be open-ended, respectful of their time, and never ask for a referral or a job. Avoid em dashes.",
        prompt: [
          `THE BANKER (dashboard record)\n${JSON.stringify(contact)}`,
          `THEIR LINKEDIN PROFILE (as the student saw it)\n${input.profileText || "(none captured: rely on the record and the web results, and keep claims general)"}`,
          `THE STUDENT\n${JSON.stringify(input.me)}`,
          input.lastEmail ? `THE STUDENT'S LAST EMAIL TO THEM\n${input.lastEmail}` : "",
          sources.length ? `PUBLIC WEB RESULTS\n${sources.map((s, i) => `[${i + 1}] ${s.title} (${s.link})\n${s.snippet}`).join("\n\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      }),
    );

    return aiJson(req, { ...output, sources: sources.map(({ title, link }) => ({ title, link })), warnings });
  } catch (e) {
    return aiErrorResponse(req, e);
  }
}
