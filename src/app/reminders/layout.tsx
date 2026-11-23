import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Reminders",
  description: "Your 9 PM text: what is in it, when it updates, and where reminders go.",
  alternates: { canonical: "/reminders" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
