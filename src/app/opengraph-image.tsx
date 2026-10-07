import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

// The link preview (iMessage, Slack, LinkedIn, X): generated at build time, so there's no image file to keep in sync.
export const alt = `${SITE.name}: ${SITE.tagline}. Track bankers, draft emails and never miss a follow-up.`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const row = (label: string, value: string, tone: string) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #e3e1d8", fontSize: 26 }}>
      <span style={{ color: "#111a28" }}>{label}</span>
      <span style={{ color: tone, fontWeight: 600 }}>{value}</span>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#13233f", padding: 64, fontFamily: "serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 560 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width="64" height="64" viewBox="0 0 64 64">
              <rect width="64" height="64" rx="14" fill="#1d3156" />
              <path d="M42.2 20.4A16 16 0 1 0 42.2 43.6" fill="none" stroke="#c99a3c" strokeWidth="7.5" strokeLinecap="round" />
            </svg>
            <span style={{ color: "#ffffff", fontSize: 44 }}>{SITE.name}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "#ffffff", fontSize: 64, lineHeight: 1.08 }}>Your IB networking, on one desk.</span>
            <span style={{ color: "#c9d1de", fontSize: 28, marginTop: 24, fontFamily: "sans-serif", lineHeight: 1.35 }}>
              Track bankers, find verified emails, draft personal outreach and never miss a follow-up.
            </span>
          </div>
          <span style={{ color: "#c99a3c", fontSize: 22, fontFamily: "sans-serif", letterSpacing: 3 }}>{SITE.tagline.toUpperCase()}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 56, flex: 1, background: "#f5f4ef", borderRadius: 18, overflow: "hidden", fontFamily: "sans-serif" }}>
          <div style={{ display: "flex", padding: "22px 24px", background: "#ffffff", fontSize: 24, color: "#6b7280", borderBottom: "1px solid #e3e1d8" }}>Today</div>
          {row("Follow-ups due", "13", "#b42318")}
          {row("Scheduled to send", "92", "#13233f")}
          {row("Banks reached", "27 / 60", "#1f7a4d")}
          {row("Replies", "3", "#1f7a4d")}
        </div>
      </div>
    ),
    size,
  );
}
