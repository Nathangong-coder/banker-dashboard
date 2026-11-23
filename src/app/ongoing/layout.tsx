import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Ongoing threads",
  description: "Every live conversation with a banker, and every email already scheduled to go out.",
  alternates: { canonical: "/ongoing" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
