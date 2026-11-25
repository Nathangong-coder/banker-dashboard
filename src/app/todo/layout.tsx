import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "To-do",
  description: "Every follow-up, reply, thank-you, check-in and reminder in one list, by when it's due.",
  alternates: { canonical: "/todo" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
