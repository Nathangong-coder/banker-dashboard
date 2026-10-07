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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
