import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Email tracking",
  description: "Which of your emails were opened, when and how often, read in the recipient's time zone, with the thread one click away.",
  alternates: { canonical: "/tracking" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
