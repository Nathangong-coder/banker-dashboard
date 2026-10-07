import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Email lab",
  description: "Which subject lines, wording, fonts and send times get replies, by bank type, team and office.",
  alternates: { canonical: "/lab" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
