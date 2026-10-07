import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Follow-ups",
  description: "Who's due for a follow-up, drafts waiting to send, scheduled emails, and daily reminders by WhatsApp or push.",
  alternates: { canonical: "/followups" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
