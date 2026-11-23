import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Gmail labels",
  description: "Keep Gmail labels on your banker threads in step with your tracker, with a preview and undo.",
  alternates: { canonical: "/labels" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
