import type { Metadata, Viewport } from "next";
import { SITE } from "@/lib/site";
import { Lexend_Deca, IBM_Plex_Mono } from "next/font/google";
import { Shell } from "@/components/Shell";
import "./globals.css";

// Lexend Deca everywhere, headings included (owner, 2026-10-19). Mono is only for code-like text (cell refs, ids).
const sans = Lexend_Deca({ variable: "--font-app-sans", subsets: ["latin"], weight: ["300", "400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-app-mono", subsets: ["latin"], weight: ["400", "500"] });

/** Sets <html data-theme> from Settings → Appearance before the first paint, so a non-default theme doesn't flash. */
const THEME_SCRIPT = `try{var t=localStorage.getItem("coverage:theme");if(t&&/^(recruitly|slate|cream|navy|graphite)$/.test(t))document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name}: ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: SITE.name, title: `${SITE.name}: ${SITE.tagline}`, description: SITE.description, url: "/" },
  twitter: { card: "summary_large_image", title: `${SITE.name}: ${SITE.tagline}`, description: SITE.description },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#0e1a2b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
