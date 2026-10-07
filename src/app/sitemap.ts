import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/** Every page. App pages show a sign-in-free shell to crawlers; the legal pages are the ones with indexable text. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number][] = [
    ["", 1],
    ["/coverage", 0.6],
    ["/find", 0.6],
    ["/drafts", 0.6],
    ["/followups", 0.6],
    ["/sheet", 0.5],
    ["/lab", 0.4],
    ["/prep", 0.4],
    ["/settings", 0.3],
    ["/privacy", 0.5],
    ["/terms", 0.5],
  ];
  const lastModified = new Date();
  return pages.map(([path, priority]) => ({ url: `${SITE.url}${path}`, lastModified, changeFrequency: "monthly", priority }));
}
