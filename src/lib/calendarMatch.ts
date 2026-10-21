/**
 * Who a calendar event was with, for the 9 PM thank-you reminders (api/server/tick). Pure, so scripts can test it.
 *
 * Order: an attendee's email is one of your contacts' → their full name in the title/description ("Nathan<>Elixa
 * Kim Coffee Chat") → a first name that only one of them has ("Nathan<>Elixa Coffee Chat", the title the dashboard's
 * own invites use). Names only count when the guest list doesn't rule the person out (`couldBeWith`). An event with no match that still looks like a chat ("coffee", "call", "A<>B") is kept by its
 * title, so a chat with someone not in the tracker yet is still on the list.
 */

export interface MatchPerson {
  contactId: string;
  name: string;
  email?: string;
}

export interface MatchEvent {
  summary: string;
  description: string;
  attendees: string[];
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9@.]+/g, " ").trim();
const hasWord = (text: string, w: string) => !!w && ` ${text} `.includes(` ${w} `);

export const looksLikeChat = (title: string) => /coffee|chat|call|catch ?up|intro|<>|\bx\b|zoom|teams|meet(ing)?\b|connect/i.test(title);

/**
 * Could this event be with them? An event with guests is only with a contact whose email is one of the guests, or whose
 * email you don't have. "Coffee w/ James" sent to your friend's Gmail used to match James Nichols by first name.
 */
export function couldBeWith(e: Pick<MatchEvent, "attendees">, p: Pick<MatchPerson, "email">) {
  if (!e.attendees.length || !p.email) return true;
  const mine = p.email.toLowerCase();
  return e.attendees.some((a) => a.toLowerCase() === mine);
}

export function matchEvent<P extends MatchPerson>(e: MatchEvent, people: P[], self?: { firstName?: string }): P | null {
  const emails = new Set(e.attendees.map((a) => a.toLowerCase()));
  const byEmail = people.find((p) => p.email && emails.has(p.email.toLowerCase()));
  if (byEmail) return byEmail;
  // By name only among people the guest list doesn't rule out.
  people = people.filter((p) => couldBeWith(e, p));
  const text = norm(`${e.summary} ${e.description}`);
  const full = people.filter((p) => {
    const parts = norm(p.name).split(" ").filter(Boolean);
    return parts.length >= 2 && hasWord(text, parts.join(" "));
  });
  if (full.length === 1) return full[0];
  const title = norm(e.summary);
  const me = norm(self?.firstName ?? "");
  const byFirst = people.filter((p) => {
    const first = norm(p.name).split(" ")[0];
    return first.length > 1 && first !== me && hasWord(title, first);
  });
  return byFirst.length === 1 ? byFirst[0] : null;
}
