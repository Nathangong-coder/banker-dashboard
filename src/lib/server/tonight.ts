import "server-only";
import type { Account, QueuedSend } from "./accounts";
import type { TrackState } from "./gmailTrack";
import { LABELS, type DigestItem } from "../digestFormat";

/**
 * What's owed on a text night, from the plan the dashboard pushed (`account.digests[day]`) corrected by what the
 * server has seen since: an email you've sent someone since the plan was made (Gmail tracking, vs `knownLast`) settles
 * whatever was owed them; a send the server made settles their follow-up; a fresh reply (≤10 days) you haven't
 * answered adds "They wrote back". Shared by the 9 PM text (api/server/tick) and the Claude connector (api/mcp).
 * `exclude` = contacts already listed (today's calendar thank-yous).
 */
export function planItems(a: Account, day: string, tracked: Record<string, TrackState>, sends: QueuedSend[], exclude = new Set<string>(), textDay = true) {
  const plan = textDay ? a.digests[day] : undefined;
  const doneSince = new Set(sends.filter((s) => s.status === "sent").map((s) => s.contactId));
  const knownLast = new Map((a.track ?? []).map((p) => [p.contactId, p.knownLast]));
  const settled = (contactId: string) => {
    const last = tracked[contactId]?.result.lastEmailedAt;
    const known = knownLast.get(contactId);
    return !!last && (!known || last > known);
  };
  // They wrote back since the plan was made: a "went quiet" / check-in nudge is stale (the reply line below replaces it).
  const heardSince = (contactId: string) => {
    const heard = tracked[contactId]?.result.lastHeardAt;
    const known = knownLast.get(contactId);
    return !!heard && !!known && heard > known;
  };
  const planned = (plan?.items ?? []).filter(
    (it) =>
      !exclude.has(it.contactId) &&
      !(doneSince.has(it.contactId) && /follow-up|move on/i.test(it.label)) &&
      !settled(it.contactId) &&
      !((it.label === LABELS.quiet || it.label === LABELS.checkIn) && heardSince(it.contactId)),
  );
  const listed = new Set([...exclude, ...planned.map((i) => i.contactId)]);
  const owed: DigestItem[] = [];
  if (textDay)
    for (const p of a.track ?? []) {
      const r = tracked[p.contactId]?.result;
      if (!r?.lastHeardAt || listed.has(p.contactId) || (r.lastEmailedAt && r.lastEmailedAt > r.lastHeardAt)) continue;
      // Only an email the dashboard hadn't seen when it made the plan: what it settled, resolved or filtered out as
      // noise stays out (owner, 2026-11-22: the text and Things to think about must list the same people).
      const known = knownLast.get(p.contactId);
      if (known && r.lastHeardAt <= known) continue;
      // Only fresh ones: older silences are the dashboard's call.
      if (Date.now() - Date.parse(r.lastHeardAt) < 10 * 86_400_000) owed.push({ contactId: p.contactId, name: p.name, email: p.emails[0], label: LABELS.replyOwed });
    }
  return { items: [...planned, ...owed], queuedAhead: plan?.queued ?? 0 };
}
