import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Firms",
  description: "Every firm you're networking with, scored on replies, calls, referrals and how your chats went, next to your own rating and notes.",
  alternates: { canonical: "/firms" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
