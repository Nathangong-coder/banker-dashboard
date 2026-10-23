import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

// The link preview (iMessage, Slack, LinkedIn, X): generated at build time, so there's no image file to keep in sync.
export const alt = `${SITE.name}: ${SITE.tagline}. Track bankers, draft emails and never miss a follow-up.`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const row = (label: string, value: string, tone: string) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #e4e2da", fontSize: 26 }}>
      <span style={{ color: "#0e1a2b" }}>{label}</span>
      <span style={{ color: tone, fontWeight: 600 }}>{value}</span>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0e1a2b", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 560 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* The logo (components/Logo.tsx), with a light edge so it shows on the navy background. */}
            <svg width="64" height="64" viewBox="0 0 128 128">
              <rect x="2" y="2" width="124" height="124" rx="27" fill="#0e1a2b" stroke="#2b3a50" strokeWidth="4" />
              <polyline points="27.5,81 49,63 61,73 88,45" fill="none" stroke="#f4f3ef" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="93" cy="40" r="13" fill="#1f7a5c" />
            </svg>
            <span style={{ color: "#ffffff", fontSize: 44 }}>{SITE.name}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "#ffffff", fontSize: 64, lineHeight: 1.08 }}>Your IB networking, on one desk.</span>
            <span style={{ color: "#c9d1de", fontSize: 28, marginTop: 24, fontFamily: "sans-serif", lineHeight: 1.35 }}>
              Track bankers, find verified emails, draft personal outreach and never miss a follow-up.
            </span>
          </div>
          <span style={{ color: "#3cb98b", fontSize: 22, fontFamily: "sans-serif", letterSpacing: 3 }}>{SITE.tagline.toUpperCase()}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 56, flex: 1, background: "#f4f3ef", borderRadius: 18, overflow: "hidden", fontFamily: "sans-serif" }}>
          <div style={{ display: "flex", padding: "22px 24px", background: "#ffffff", fontSize: 24, color: "#6b7280", borderBottom: "1px solid #e4e2da" }}>Today</div>
          {row("Follow-ups due", "13", "#b42318")}
          {row("Scheduled to send", "92", "#0e1a2b")}
          {row("Banks reached", "27 / 60", "#1f7a5c")}
          {row("Replies", "3", "#1f7a5c")}
        </div>
      </div>
    ),
    size,
  );
}
