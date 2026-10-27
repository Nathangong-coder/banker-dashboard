/** Site-wide facts for metadata, the legal pages, the sitemap and social previews. */
export const SITE = {
  name: "Coverage",
  tagline: "Banker Networking Desk",
  description:
    "Coverage helps students run investment-banking networking: import your tracker spreadsheet, find bankers and verified emails, draft personal emails, and never miss a follow-up.",
  url: (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.NEXT_PUBLIC_SITE_URL) || "https://banker-dashboard-three.vercel.app",
  /** Who to write to about privacy, terms or data deletion. The owner can change this. */
  contact: "nagong1@g.ucla.edu",
  /**
   * The browser extension (extension/, /extension pages). `chromeUrl` = its Chrome Web Store listing: empty until the
   * listing is approved, then paste it here and the /extension page's buttons point to it.
   */
  extension: {
    chromeUrl: "https://chromewebstore.google.com/detail/hjmfcaldipgcjffmcemcljllmlpjlnlp",
    version: "1.16.0",
  },
  /** Last time the privacy policy / terms were changed (shown on the pages). */
  legalUpdated: "October 26, 2026",
};
