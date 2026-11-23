import type { NextConfig } from "next";

/**
 * Security headers for every response. Vercel already serves HTTPS only (HTTP requests get a 308 to HTTPS); HSTS
 * tells browsers to never try HTTP again. No CSP yet: Google Identity Services, the bookmarklet hand-off and inline
 * styles from the sheet grid would need a carefully tested policy.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app is never meant to be framed (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  // Google's sign-in popup talks back to its opener, so keep popups allowed.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    // Icons and the manifest are cached for a day (owner, 2026-11-23: they were fetched again on every page load,
    // ~190 requests each in 3 days). They only change with a new logo.
    const cache = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];
    return [
      { source: "/:path*", headers: securityHeaders },
      ...["/icon-192.png", "/icon-512.png", "/manifest.webmanifest", "/favicon.ico", "/apple-icon.png", "/icon.svg"].map((source) => ({ source, headers: cache })),
    ];
  },
  async redirects() {
    // Firms moved into Bank coverage → Analytics (owner, 2026-11-21).
    return [{ source: "/firms", destination: "/coverage?tab=analytics", permanent: false }];
  },
};

export default nextConfig;
