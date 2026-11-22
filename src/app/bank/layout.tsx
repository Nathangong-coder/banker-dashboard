import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Bank",
  description: "One bank: its process step, people, next steps and why it ranks where it does.",
  alternates: { canonical: "/bank" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
