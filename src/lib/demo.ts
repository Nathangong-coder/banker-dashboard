"use client";

import type { Contact, InfoSession, Status } from "./types";
import type { JobApplication } from "./apply";
import { EMPTY_APPLY } from "./apply";

/**
 * Signed out = the demo (owner, 2026-10-25): a made-up recruiting season so a visitor can click around before signing
 * in. Every name is invented (like the landing page mocks). Nothing here is saved; real actions ask you to sign in.
 * Dates are relative to today so the follow-ups, calendar and stats look alive.
 */

const day = 86_400_000;
const ago = (d: number, h = 10) => new Date(Date.now() - d * day + (h - 12) * 3_600_000).toISOString();
const ahead = (d: number, h = 18) => new Date(Date.now() + d * day + (h - 12) * 3_600_000).toISOString();

type P = [name: string, bank: string, region: Contact["region"], team: string, position: string, status: Status, sentDaysAgo?: number, extra?: Partial<Contact>];
const PEOPLE: P[] = [
  ["Maya Okafor", "Goldman Sachs", "SF", "Tech", "Analyst", "replied", 12, { repliedAt: ago(9) }],
  ["Daniel Brooks", "Goldman Sachs", "NY", "Generalist", "Associate", "sent", 8],
  ["Priya Raman", "Morgan Stanley", "SF", "Tech", "Analyst", "call_scheduled", 15, { repliedAt: ago(11), call: { at: ahead(2, 16), eventId: "demo-ev-1", link: "", invited: true } }],
  ["Ethan Park", "Morgan Stanley", "NY", "Generalist", "Analyst", "followed_up", 16, { followUps: 1, lastTouchAt: ago(8) }],
  ["Sofia Alvarez", "J.P. Morgan", "SF", "Tech", "Associate", "sent", 7],
  ["Marcus Chen", "Evercore", "SF", "Tech", "Analyst", "replied", 20, { repliedAt: ago(17), referral: { at: ago(5), source: "manual" } }],
  ["Hannah Lee", "Evercore", "NY", "Generalist", "Associate", "drafted", undefined, { draft: { subject: "UCLA Student Seeking to Connect", body: "Hi Hannah,\n\nI hope this email finds you well!…", createdAt: ago(1) } }],
  ["Omar Haddad", "Qatalyst Partners", "SF", "Tech", "Analyst", "new"],
  ["Grace Kim", "Centerview Partners", "NY", "Generalist", "Analyst", "new"],
  ["Lucas Moreau", "Moelis & Company", "LA", "Generalist", "Associate", "sent", 3],
  ["Aisha Patel", "Jefferies", "SF", "Tech", "Analyst", "replied", 25, { repliedAt: ago(22) }],
  ["Ryan Torres", "Lazard", "NY", "Generalist", "Vice President", "new"],
];

function contact([name, bank, region, team, position, status, sent, extra]: P, i: number): Contact {
  const [firstName, ...rest] = name.split(" ");
  const sentAt = sent !== undefined ? ago(sent) : undefined;
  return {
    id: `demo_${i}`,
    name,
    firstName,
    lastName: rest.join(" "),
    bank,
    region,
    location: region,
    team,
    position,
    email: `${firstName.toLowerCase()}.${rest.join("").toLowerCase()}@example.com`,
    emailSource: "manual",
    linkedin: "",
    comment: "",
    status,
    source: "manual",
    followUps: 0,
    history: sentAt ? [{ at: sentAt, type: "sent" }] : [],
    ...(sentAt ? { sentAt, lastTouchAt: sentAt, lastEmailedAt: sentAt } : {}),
    ...extra,
  } as Contact;
}

const JOBS: Partial<JobApplication>[] = [
  { company: "Goldman Sachs", role: "2027 Summer Analyst, Investment Banking", status: "submitted", location: "San Francisco, CA" },
  { company: "Morgan Stanley", role: "2027 Investment Banking Summer Analyst", status: "applying", location: "New York, NY" },
  { company: "Evercore", role: "Summer Analyst, Advisory", status: "saved", location: "San Francisco, CA", deadline: ahead(9).slice(0, 10) },
  { company: "J.P. Morgan", role: "2027 Investment Banking Summer Analyst Program", status: "interview", location: "San Francisco, CA" },
];

export function demoState() {
  const contacts = PEOPLE.map(contact);
  const jobs = JOBS.map((j, i) => ({ id: `demo_job_${i}`, url: "https://example.com/careers", createdAt: ago(20 - i * 3), ...j }) as JobApplication);
  const infoSessions: InfoSession[] = [
    { id: "demo_is_1", title: "Barclays Investment Banking Info Session", firm: "Barclays", start: ahead(3, 17), end: ahead(3, 18), allDay: false, source: "manual", people: [] },
    { id: "demo_is_2", title: "Houlihan Lokey Info Session", firm: "Houlihan Lokey", start: ago(4, 17), end: ago(4, 18), allDay: false, source: "manual", people: [], attended: true, pending: [{ name: "Jamie Rivera", firm: "Houlihan Lokey", note: "Talked about the TMT group", from: "manual" }] },
  ];
  return { contacts, infoSessions, apply: { ...EMPTY_APPLY, jobs } };
}
