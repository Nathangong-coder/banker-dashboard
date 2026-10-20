import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Activity log",
  description: "Log coffee chats, calls, emails and in-person conversations by hand, attached to the right person and graded by AI.",
  alternates: { canonical: "/log" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
