"use client";

import { ExternalLink, Mail, Search, UserRound } from "lucide-react";
import { cn } from "@/lib/util";
import { gmailSearchUrl, gmailThreadUrl, personQuery } from "@/lib/gmailLinks";
import type { Contact } from "@/lib/types";

/**
 * Check a person by hand (owner, 2026-11-23): their Gmail thread, every email with them in Gmail (all addresses on
 * file + their name, so a second address or a forward shows up), and LinkedIn. Opens in a new tab; changes nothing.
 */
export function PersonLinks({ c, className }: { c: Contact; className?: string }) {
  const thread = c.mail?.messages?.at(-1)?.threadId ?? c.threadId;
  const link = "inline-flex items-center gap-1 text-muted hover:text-brass-ink hover:underline";
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]", className)}>
      {thread && (
        <a href={gmailThreadUrl(thread)} target="_blank" rel="noreferrer" className={link} title="Open the email thread in Gmail">
          <Mail className="size-3.5" aria-hidden="true" /> Thread
        </a>
      )}
      {(c.email || c.name) && (
        <a href={gmailSearchUrl(personQuery(c))} target="_blank" rel="noreferrer" className={link} title="Every email with them in Gmail, at any address on file">
          <Search className="size-3.5" aria-hidden="true" /> Search Gmail
        </a>
      )}
      {c.linkedin && (
        <a href={c.linkedin} target="_blank" rel="noreferrer" className={link} title="Their LinkedIn profile">
          <UserRound className="size-3.5" aria-hidden="true" /> LinkedIn
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      )}
    </span>
  );
}
