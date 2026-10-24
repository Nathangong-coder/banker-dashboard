import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Templates",
  description: "Your email templates, the hooks picked by team, and the resume attached to first emails.",
  alternates: { canonical: "/templates" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
