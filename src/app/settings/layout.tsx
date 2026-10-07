import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Settings",
  description: "Your profile, email writing and sending rules, outreach rules, connected services, reminders and backups.",
  alternates: { canonical: "/settings" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
