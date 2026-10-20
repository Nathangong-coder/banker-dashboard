import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Calendar",
  description: "Your coffee chats and info sessions from Google Calendar, with prep before and a log + LinkedIn reminder after.",
  alternates: { canonical: "/calendar" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
