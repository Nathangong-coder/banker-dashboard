import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Bank coverage",
  description: "See which banks and desks you've reached, what's ready to email, and where you have no one yet.",
  alternates: { canonical: "/coverage" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
