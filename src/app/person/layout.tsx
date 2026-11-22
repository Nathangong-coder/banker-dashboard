import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Person",
  description: "One banker: their emails, chats, team and referrals.",
  alternates: { canonical: "/person" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
