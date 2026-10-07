import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Spreadsheet",
  description: "Your recruiting tracker in an Excel-like grid: edit cells, follow tab links and save back to your .xlsx.",
  alternates: { canonical: "/sheet" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
