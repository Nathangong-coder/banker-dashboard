import type { Settings, Template } from "./types";

export const DEFAULT_CRITERIA = `Include a person ONLY if ALL THREE groups are satisfied:

1) ROLE: Works in investment banking at the target bank, in a Technology coverage group (Tech / TMT / Technology, Media & Telecom) anywhere, OR is a Generalist banker based in New York. EXCLUDE anyone in a Healthcare group.

2) BACKGROUND: Graduated from a University of California campus (UCLA, UC Berkeley, UC San Diego, UC Irvine, UC Davis, UC Santa Barbara, UC Santa Cruz, UC Riverside, UC Merced), OR is originally from Washington State (e.g. high school in WA, University of Washington, grew up in Seattle/Bellevue/etc.).

3) LOCATION: Currently lives/works in California or New York.

If the profile snippet is missing information needed to confirm a group, answer "maybe" rather than "no" unless another group clearly fails.`;

export const DEFAULT_QUERIES = [
  `site:linkedin.com/in "{bank}" "investment banking" ("technology" OR "TMT" OR "tech") ("UCLA" OR "Berkeley" OR "UC San Diego" OR "UC Irvine" OR "UC Davis" OR "UC Santa Barbara" OR "University of California")`,
  `site:linkedin.com/in "{bank}" "investment banking" "generalist" "New York" ("UCLA" OR "Berkeley" OR "UC San Diego" OR "UC Irvine" OR "UC Davis" OR "University of California")`,
  `site:linkedin.com/in "{bank}" "investment banking" ("University of Washington" OR "Seattle" OR "Bellevue" OR "Washington State")`,
];

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
  },
  keys: {
    apollo: "",
    hunter: "",
    serper: "",
    ai: "",
    aiModel: "claude-sonnet-5",
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
};

export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: "tpl_uc",
    name: "UC alum connect",
    whenToUse: "Contact went to a University of California school (UCLA, Berkeley, UCSD, etc.).",
    kind: "initial",
    attachResume: true,
    subject: "{{my_school}} Student Interested in {{bank}}",
    body: `Hi {{first_name}},

I hope you're doing well! My name is {{my_name}}, and I'm a {{my_year}} at {{my_school}} studying {{my_major}}. [[AI: one sentence noting the shared UC connection with {{first_name}} (their school: {{their_school}}), specific but not over-the-top]]

I'm very interested in {{bank}}'s [[AI: their group, e.g. "Technology group" — infer from their position/team, else "investment banking division"]] and would really appreciate the chance to learn about your experience. Would you have 15 minutes for a quick call in the coming weeks?

I've attached my resume for your reference. Thank you for your time!

Best,
{{my_name}}`,
  },
  {
    id: "tpl_wa",
    name: "Washington connection",
    whenToUse: "Contact is originally from Washington State or went to school in WA.",
    kind: "initial",
    attachResume: true,
    subject: "Fellow Washingtonian Interested in {{bank}}",
    body: `Hi {{first_name}},

My name is {{my_name}}, a {{my_year}} at {{my_school}} studying {{my_major}}. [[AI: one sentence noting we're both from Washington State, based on their background]]

I'm hoping to recruit for investment banking and would love to hear about your path to {{bank}}. Would you be open to a brief 15-minute call sometime soon?

I've attached my resume for context. Thanks so much!

Best,
{{my_name}}`,
  },
  {
    id: "tpl_generic",
    name: "General outreach",
    whenToUse: "Default when no specific shared connection applies.",
    kind: "initial",
    attachResume: true,
    subject: "{{my_school}} Student — Interest in {{bank}}",
    body: `Hi {{first_name}},

I hope your week is going well. My name is {{my_name}}, a {{my_year}} at {{my_school}} studying {{my_major}}. [[AI: one genuine, specific sentence about why their role/group caught my attention, based only on the facts given]]

Would you have 15 minutes in the coming weeks for a quick call? I'd love to learn about your experience at {{bank}}.

I've attached my resume. Thank you!

Best,
{{my_name}}`,
  },
  {
    id: "tpl_followup",
    name: "Follow-up",
    whenToUse: "Follow-up after no response to the first email.",
    kind: "follow_up",
    attachResume: false,
    subject: "Re: {{original_subject}}",
    body: `Hi {{first_name}},

I wanted to follow up on my note below in case it got buried — I know things get busy. I'd still really appreciate 15 minutes to hear about your experience at {{bank}} whenever works for you.

Thanks again,
{{my_name}}`,
  },
];
