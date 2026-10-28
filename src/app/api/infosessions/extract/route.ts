import { generateText, Output, type UserContent } from "ai";
import { z } from "zod";
import { aiJson, aiErrorResponse, withAi, HttpError } from "@/lib/server/ai";

/**
 * People from an info-session capture (app/info-sessions): a photo / screenshot (name tags, a sign-in sheet, a Zoom
 * participant list, a business card) and/or typed notes. Stateless: nothing is stored or logged.
 */
export const maxDuration = 60;

const DATA_URL = /^data:(image\/(?:jpeg|jpg|png|webp|gif|heic|heif));base64,([A-Za-z0-9+/=\s]+)$/;

const Body = z
  .object({
    /** data: URL, ≤ ~3 MB of base64. */
    image: z.string().max(4_200_000).regex(DATA_URL, "The image must be a JPEG/PNG/WebP data URL.").optional(),
    text: z.string().max(6000).optional(),
    /** One person's LinkedIn profile page, copied whole (Ctrl+A, Ctrl+C). */
    profile: z.string().max(15_000).optional(),
    session: z.object({ firm: z.string().max(200), title: z.string().max(300), date: z.string().max(40) }).optional(),
    /** The user's own name, so they're never returned as someone they met. */
    me: z.string().max(120).optional(),
  })
  .refine((b) => !!b.image || !!b.text?.trim() || !!b.profile?.trim(), "Send a photo, some text or a LinkedIn profile.");

const Profile = z.object({
  name: z.string().describe("The profile owner's full name as shown at the top (First Last), without credentials like CFA"),
  title: z.string().describe("Their CURRENT job title from the Experience section (the role with no end date), e.g. 'Investment Banking Analyst'. Empty if unclear"),
  firm: z.string().describe("The firm of that current role, as named in Experience"),
  location: z.string().describe("Their location as shown under the headline or on the current role (e.g. 'San Francisco, California'), else empty"),
  school: z.string().describe("Their most recent university (Education section), else empty"),
  linkedin: z.string().describe("A linkedin.com/in/ URL only if literally in the text, else empty"),
});

const People = z.object({
  people: z
    .array(
      z.object({
        name: z.string().describe("Full name as written (First Last). Fix obvious capitalization only."),
        title: z.string().describe("Their job title if shown (Analyst, Associate, VP…), else empty"),
        firm: z.string().describe("Their firm if shown and different from the session's firm, else empty"),
        email: z.string().describe("Email ONLY if it is literally written in the capture, else empty. Never guess one."),
        linkedin: z.string().describe("A linkedin.com/in/ URL only if literally written, else empty"),
        note: z.string().describe("What the student noted about this person (topics, school, team), else empty. Short."),
      }),
    )
    .max(80),
  notes: z
    .string()
    .describe(
      "Everything in the student's typed text that is NOT about one specific person (what the speakers said, recruiting timeline, tips, impressions), " +
        "kept in the student's own words, one point per line. Empty for photos and when every line is about a person.",
    ),
});

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** One person from a pasted LinkedIn page. The page copy also holds "People also viewed" and the reader's own nav: only the owner counts. */
async function readProfile(req: Request, text: string, sessionFirm?: string) {
  const { output } = await withAi(req, (model, opts) =>
    generateText({
      ...opts,
      model,
      output: Output.object({ schema: Profile }),
      system: "You read LinkedIn profile pages accurately. You never make up names, titles, firms, schools or URLs. Avoid em dashes.",
      prompt: [
        "This is the text of ONE person's LinkedIn profile page, copied whole by a student who met them at a recruiting event" + (sessionFirm ? ` (${sessionFirm}).` : "."),
        "Return the profile owner only: ignore the site navigation, 'People also viewed', 'People you may know', ads and other people's names.",
        "Their current role is the Experience entry without an end date (\"Present\"). Former roles don't count.",
        `PROFILE TEXT\n${text.trim()}`,
      ].join("\n\n"),
    }),
  );
  const linkedin = /linkedin\.com\/in\//i.test(output.linkedin) && text.includes(clean(output.linkedin)) ? clean(output.linkedin) : undefined;
  const name = clean(output.name);
  if (name.length < 2) return [];
  return [{ name, title: clean(output.title) || undefined, firm: clean(output.firm) || undefined, location: clean(output.location) || undefined, school: clean(output.school) || undefined, linkedin }];
}

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Bad request.");
    const input = parsed.data;
    if (input.profile?.trim()) return aiJson(req, { people: await readProfile(req, input.profile, input.session?.firm) });
    const m = input.image?.match(DATA_URL);
    const s = input.session;
    const prompt = [
      "Read the people in this capture from a firm recruiting event (an info session or networking night) a college student attended.",
      s ? `The session: "${s.title}" by ${s.firm} on ${s.date}. People without another firm written next to them work at ${s.firm}.` : "",
      input.me ? `The student is ${input.me}: never return them.` : "",
      "It can be a photo of name tags or business cards, a sign-in sheet, a screenshot of a Zoom / Teams participant list, or notes the student typed.",
      "Return real people only (the bankers / recruiters / alumni the student met). Skip: the student, slide text, company or group names, " +
        "headings, room names, generic labels like 'Host' or 'Guest', and phone numbers. In a participant list, the student's own entry is often marked '(me)'.",
      "Never invent or guess an email or LinkedIn URL: only copy ones that are literally written. If a typed line says something about a person " +
        "(\"Jane Doe - TMT analyst, went to UCLA\"), put the title in title and the rest in note. Typed lines that aren't about one person " +
        "(\"they said the SA class is 12 people\") are not people: put them in notes.",
      input.text?.trim() ? `THE STUDENT'S TEXT\n${input.text.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const content: UserContent = [{ type: "text", text: prompt }];
    if (m) content.push({ type: "file", mediaType: m[1] === "image/jpg" ? "image/jpeg" : m[1], data: { type: "data", data: m[2].replace(/\s+/g, "") } });

    const { output } = await withAi(req, (model, opts) =>
      generateText({
        ...opts,
        model,
        output: Output.object({ schema: People }),
        system: "You transcribe names from event photos and notes accurately. You never make people, emails or titles up. Avoid em dashes.",
        messages: [{ role: "user", content }],
      }),
    );

    // An email the model "read" from typed text must actually be in that text (images can't be checked this way).
    const typed = (input.text ?? "").toLowerCase();
    const me = clean(input.me ?? "").toLowerCase();
    const seen = new Set<string>();
    const people = output.people
      .map((p) => {
        const email = clean(p.email).toLowerCase();
        const okEmail = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) && (m || typed.includes(email));
        const linkedin = /linkedin\.com\/in\//i.test(p.linkedin) ? clean(p.linkedin) : "";
        return {
          name: clean(p.name),
          title: clean(p.title) || undefined,
          firm: clean(p.firm) || undefined,
          email: okEmail ? email : undefined,
          linkedin: linkedin || undefined,
          note: clean(p.note) || undefined,
        };
      })
      .filter((p) => {
        const key = p.name.toLowerCase();
        if (p.name.length < 2 || key === me || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return aiJson(req, { people, notes: input.text?.trim() ? output.notes.trim().slice(0, 4000) || undefined : undefined });
  } catch (e) {
    return aiErrorResponse(req, e);
  }
}
