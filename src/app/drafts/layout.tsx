import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Email drafts",
  description: "Write personal outreach from your templates and hooks, check seniority and verified emails, and send drafts to Gmail.",
  alternates: { canonical: "/drafts" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
