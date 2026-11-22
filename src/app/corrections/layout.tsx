import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Corrections",
  description: "Fix anything Coverage guessed: firms, tiers, programs and applications, and which offices hire.",
  alternates: { canonical: "/corrections" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
