import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Coffee chat prep",
  description: "A one-page brief before a call: their path, common ground, a 30-second intro and tailored questions.",
  alternates: { canonical: "/prep" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
