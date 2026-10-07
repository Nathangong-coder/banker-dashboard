/** Site-wide facts for metadata, the legal pages, the sitemap and social previews. */
export const SITE = {
  name: "Coverage",
  tagline: "Banker Networking Desk",
  description:
    "Coverage helps students run investment-banking networking: import your tracker spreadsheet, find bankers and verified emails, draft personal emails, and never miss a follow-up.",
  url: (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.NEXT_PUBLIC_SITE_URL) || "https://banker-dashboard-three.vercel.app",
  /** Who to write to about privacy, terms or data deletion. The owner can change this. */
  contact: "nagong1@g.ucla.edu",
  /** Last time the privacy policy / terms were changed (shown on the pages). */
  legalUpdated: "October 6, 2026",
};
