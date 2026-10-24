import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Applications",
  description: "Track job applications and let the Coverage extension fill them from your saved info, resume and writing style. You review and submit.",
  alternates: { canonical: "/applications" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
