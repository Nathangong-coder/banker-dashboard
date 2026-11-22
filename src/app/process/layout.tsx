import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Process tracker",
  description: "Every bank you're recruiting at, dragged through your process from networking to offer, colored by how it's going.",
  alternates: { canonical: "/process" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
