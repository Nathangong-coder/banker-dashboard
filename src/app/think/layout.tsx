import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Warm follow-ups",
  description: "Replies you haven't answered, people who went quiet, and the dates bankers told you to come back.",
  alternates: { canonical: "/think" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
