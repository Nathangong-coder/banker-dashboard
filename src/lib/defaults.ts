import type { Settings, Template } from "./types";

export const DEFAULT_CRITERIA = `Include a person ONLY if ALL THREE groups are satisfied:

1) ROLE: Works in investment banking at the target bank, in a Technology coverage group (Tech / TMT / Technology, Media & Telecom) anywhere, OR is a Generalist banker based in New York. EXCLUDE anyone in a Healthcare group.

2) BACKGROUND: Graduated from a University of California campus (UCLA, UC Berkeley, UC San Diego, UC Irvine, UC Davis, UC Santa Barbara, UC Santa Cruz, UC Riverside, UC Merced), OR is originally from Washington State (e.g. high school in WA, University of Washington, grew up in Seattle/Bellevue/etc.).

3) LOCATION: Currently lives/works in California or New York.

If the profile snippet is missing information needed to confirm a group, answer "maybe" rather than "no" unless another group clearly fails.`;

/** Kept well under Google's 32-word query limit (longer queries get silently truncated). */
export const DEFAULT_QUERIES = [
  `site:linkedin.com/in "{bank}" "investment banking" (technology OR TMT) (UCLA OR Berkeley OR UCSD OR UCI OR "UC Davis" OR UCSB)`,
  `site:linkedin.com/in "{bank}" "investment banking" generalist "New York" (UCLA OR Berkeley OR UCSD OR "University of California")`,
  `site:linkedin.com/in "{bank}" "investment banking" ("University of Washington" OR Seattle OR Bellevue)`,
];

/** v1 defaults, replaced automatically by the store migration if the user never edited them. */
export const LEGACY_QUERIES_V1 = [
  `site:linkedin.com/in "{bank}" "investment banking" ("technology" OR "TMT" OR "tech") ("UCLA" OR "Berkeley" OR "UC San Diego" OR "UC Irvine" OR "UC Davis" OR "UC Santa Barbara" OR "University of California")`,
  `site:linkedin.com/in "{bank}" "investment banking" "generalist" "New York" ("UCLA" OR "Berkeley" OR "UC San Diego" OR "UC Irvine" OR "UC Davis" OR "University of California")`,
  `site:linkedin.com/in "{bank}" "investment banking" ("University of Washington" OR "Seattle" OR "Bellevue" OR "Washington State")`,
];

/** Rough Google word count ("site:x", quoted phrases' words, and OR all count). */
export function queryWordCount(q: string, bank = "Perella Weinberg Partners") {
  return q.replaceAll("{bank}", bank).split(/[\s()"]+/).filter(Boolean).length;
}

export const DEFAULT_SETTINGS: Settings = {
  profile: {
    name: "",
    school: "",
    year: "",
    major: "",
    email: "",
    phone: "",
    linkedin: "",
    hometown: "",
    signature: "",
    pitch: "",
    club: "",
    schoolNickname: "",
    schoolCity: "",
  },
  keys: {
    googleClientId: "",
    ntfyTopic: "",
    ntfyServer: "https://ntfy.sh",
    twilioSid: "",
    twilioToken: "",
    twilioFrom: "",
    twilioMessagingServiceSid: "",
    twilioTo: "",
    whatsappPhone: "",
    whatsappApiKey: "",
  },
  vault: { apollo: [], hunter: [], serper: [], brave: [], ai: [] },
  ai: { provider: "anthropic", model: "claude-sonnet-5" },
  followUp: {
    firstAfterDays: 7,
    nextAfterDays: 7,
    maxFollowUps: 2,
    moveOnAfterDays: 7,
    livePerBank: 2,
  },
  prospect: {
    criteria: DEFAULT_CRITERIA,
    queries: DEFAULT_QUERIES,
    resultsPerQuery: 20,
  },
  enrich: {
    revealPersonalEmails: false,
  },
  emailStyle: { font: "garamond" },
};

/*
 * Starter templates, adapted from a real IB networking playbook ("Follow up Templates.docx").
 * Wording is kept verbatim; only the blanks became placeholders:
 *   NAME (greeting) → {{first_name}}, NAME (sender / sign-off) → {{my_name}}, FIRM → {{bank}},
 *   POSITION → {{position}}, SCHOOL → {{their_school}}, CLUB → {{my_club}}, HOMETOWN → {{my_hometown}},
 *   CITY → {{their_city}}, the sender's school/major/background → {{my_school}} / {{my_major}} / {{my_pitch}}.
 * Things only the recipient's profile can tell us (their high school, shared major) are [[AI: …]] slots.
 */
const INTRO = `My name is {{my_name}}, I'm a {{my_major}} student at {{my_school}}, and I am very interested in pursuing investment banking. {{my_pitch}}`;
const ASK = `I know that as a {{position}}, you must place a lot of value on your time, but if you are available, would you be open to having a call sometime this week or next week to talk about your career? If so, I can send my availability, and I've attached my resume for your reference.`;
const CLOSE = `Thank you so much for your time, and I hope we get a chance to connect!

Sincerely,
{{my_name}}`;

const personal = (hook: string) => `Hi {{first_name}},

I hope this email finds you well! ${INTRO}

${hook}

${ASK}

${CLOSE}`;

export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: "tpl_standard",
    name: "Standard",
    whenToUse: "Default for analysts and associates when there's no specific shared connection.",
    kind: "initial",
    attachResume: true,
    subject: "{{my_school}} Student Seeking to Connect",
    body: `Hi {{first_name}},

I hope this email finds you well! My name is {{my_name}}, I'm a student at {{my_school}} majoring in {{my_major}}, and I wanted to reach out to you because I'm interested in learning more about investment banking at {{bank}}.

${ASK}

${CLOSE}`,
  },
  {
    id: "tpl_senior",
    name: "VP / MD and above",
    whenToUse: "Senior bankers (Vice President, Director, Managing Director, Partner, Head, Chairman) with no specific shared connection.",
    kind: "initial",
    attachResume: true,
    subject: "{{my_school}} Student Seeking to Connect",
    body: `Hi {{first_name}},

I hope this email finds you well! My name is {{my_name}}, I'm a student at {{my_school}} majoring in {{my_major}}, and I wanted to reach out to you because I'm interested in learning more about investment banking at {{bank}}.

So far, I've spoken to a number of analysts and associates, but I wanted to reach out to you specifically, because given your position as a {{position}}, I felt that you would have a longer term view on the industry and differentiated insights into the merits of a long term career in investment banking.

${ASK}

${CLOSE}`,
  },
  {
    id: "tpl_same_school",
    name: "Same-school alum (e.g. UCLA)",
    whenToUse: "Contact went to the same university as me for undergrad.",
    kind: "initial",
    attachResume: true,
    subject: "Fellow {{my_school_nickname}} Seeking to Connect",
    body: personal(
      "Seeing as how you also went to {{my_school}}, I wanted to reach out to you specifically to hear more about your journey and how you found yourself at {{bank}} after graduation.",
    ),
  },
  {
    id: "tpl_bschool",
    name: "Business-school alum (e.g. Anderson)",
    whenToUse: "Contact went to my university's business/grad school (e.g. UCLA Anderson MBA).",
    kind: "initial",
    attachResume: true,
    subject: "Fellow {{my_school_nickname}} Seeking to Connect",
    body: personal(
      "Seeing as how you also went to {{my_school}}, I wanted to reach out to you specifically to hear more about your journey and how you found yourself at {{bank}} after graduating from {{their_school}}.",
    ),
  },
  {
    id: "tpl_club",
    name: "Club alum",
    whenToUse: "Contact was a member of the same student club/organization as me.",
    kind: "initial",
    attachResume: true,
    subject: "{{my_club}} Student Seeking to Connect",
    body: `Hi {{first_name}},

I hope this email finds you well! My name is {{my_name}}, I'm a {{my_school}} student and {{my_club}} member majoring in {{my_major}}, and I wanted to reach out to you because I'm interested in learning more about investment banking at {{bank}}.

Seeing as how you were a member of {{my_club}} when you were an undergrad, I wanted to reach out to you specifically to hear more about your journey and how you found yourself at {{bank}} after graduating from {{my_school}}.

${ASK}

${CLOSE}`,
  },
  {
    id: "tpl_uc",
    name: "UC alum",
    whenToUse: "Contact went to a different University of California campus (Berkeley, UCSD, UCI, UC Davis, UCSB, etc.).",
    kind: "initial",
    attachResume: true,
    subject: "Fellow UC Student Seeking to Connect",
    body: personal(
      "Seeing as how you also went to a UC, I wanted to reach out to you specifically to hear more about your journey and how you found yourself at {{bank}} after graduating from {{their_school}}.",
    ),
  },
  {
    id: "tpl_local_uni",
    name: "Same-city university alum (e.g. LA schools)",
    whenToUse: "Contact went to another college in my school's city (e.g. LMU, Pepperdine, Occidental for LA). USC has its own template.",
    kind: "initial",
    attachResume: true,
    subject: "{{my_school}} Student Seeking to Connect",
    body: personal(
      "Seeing as how you also went to college in {{my_school_city}}, I wanted to reach out to you specifically to hear more about your journey and how you found yourself at {{bank}} after graduating from {{their_school}}.",
    ),
  },
  {
    id: "tpl_usc",
    name: "USC alum",
    whenToUse: "Contact went to USC (our crosstown school).",
    kind: "initial",
    attachResume: true,
    subject: "{{my_school}} Student Seeking to Connect",
    body: personal(
      "Seeing as how you attended USC, I was hoping to learn more about what it was like coming from {{my_school_city}} to {{their_city}} to pursue a career in investment banking, and I wanted to reach out to you specifically to learn more about your experience given the close relationship between our schools.",
    ),
  },
  {
    id: "tpl_hometown",
    name: "Hometown",
    whenToUse: "Contact is from my hometown / home state (e.g. Washington).",
    kind: "initial",
    attachResume: true,
    subject: "{{my_school}} Student from {{my_hometown}} Seeking to Connect",
    body: personal(
      "While looking through your profile, I noticed that you were from {{my_hometown}}, and being from {{my_hometown}} myself, I thought it would be great to speak with someone else from my hometown.",
    ),
  },
  {
    id: "tpl_high_school",
    name: "Hometown (same high school area)",
    whenToUse: "Contact went to a high school in my hometown area (their high school is visible on their profile).",
    kind: "initial",
    attachResume: true,
    subject: "{{my_school}} Student from {{my_hometown}} Seeking to Connect",
    body: personal(
      "While looking through your profile, I noticed that you went to [[AI: the contact's high school, from their profile or my notes]], and being from {{my_hometown}} myself, I thought it would be great to speak with someone else from my hometown.",
    ),
  },
  {
    id: "tpl_non_target",
    name: "Non-target school",
    whenToUse: "Contact went to a non-target school (not traditionally recruited by investment banks), especially NY bankers.",
    kind: "initial",
    attachResume: true,
    subject: "{{my_school}} Student Seeking to Connect",
    body: personal(
      "Seeing as how you studied at {{their_school}} and I'm currently at {{my_school}}, I wanted to reach out to you specifically to hear about your experiences coming from a school that isn't traditionally targeted by investment banks. Given that I also attend a non-target, I was hoping to gain some insight into how you overcame that hurdle and got to where you are today.",
    ),
  },
  {
    id: "tpl_major",
    name: "Same major",
    whenToUse: "Contact studied the same major as me (e.g. applied math) and nothing more specific applies.",
    kind: "initial",
    attachResume: true,
    subject: "Fellow [[AI: the major we share, short form, e.g. Applied Math]] Major Seeking to Connect",
    body: personal(
      "Seeing as how you also majored in [[AI: the major we share; if we share anything else (school, club, hometown), add it here as another 'also']], I wanted to reach out to you specifically to hear more about your journey and how you found yourself at {{bank}} after graduation.",
    ),
  },
  {
    id: "tpl_followup_1",
    name: "First follow-up",
    whenToUse: "First follow-up when there's no reply to the first email.",
    kind: "follow_up",
    step: 1,
    attachResume: false,
    subject: "Re: {{original_subject}}",
    body: `Hi {{first_name}},

I hope you're having a pleasant day! I just wanted to follow up on my last email and check in again on your availability.

Would you be willing to have a quick chat sometime this week or next week to talk about your career and background? Thanks again, and I hope to hear from you!

Regards,
{{my_name}}`,
  },
  {
    id: "tpl_followup_2",
    name: "Second follow-up",
    whenToUse: "Second (final) follow-up.",
    kind: "follow_up",
    step: 2,
    attachResume: false,
    subject: "Re: {{original_subject}}",
    body: `Hi {{first_name}},

I hope that things have been going well since I last reached out! I just wanted to send one more follow up on my last email and check in again on your schedule.

How does your availability look, and would you be open to the idea of speaking with me about your career and experiences? If things are too busy at the moment, that is completely understandable. Thank you for your time!

Kind regards,
{{my_name}}`,
  },
];
