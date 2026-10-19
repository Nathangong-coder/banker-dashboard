import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Info sessions",
  description: "Every firm info session from your calendar, who you met at each, and same-night thank-you emails.",
  alternates: { canonical: "/info-sessions" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
