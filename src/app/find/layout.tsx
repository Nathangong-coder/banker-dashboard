import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Find people",
  description: "Find bankers by firm, office and team, screened against your criteria, without scraping LinkedIn.",
  alternates: { canonical: "/find" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
