import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/** Crawlers: the public pages yes, the API no. App pages are fine to crawl (they hold no data server-side). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
