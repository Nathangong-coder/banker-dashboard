// Where your Coverage dashboard lives. Kept in chrome.storage.sync so it follows your browser profile.
// Only the deployed site or a local dev server are allowed: the extension hands page text to this address.

export const DEFAULT_DASHBOARD = "https://banker-dashboard-three.vercel.app";

/** https anywhere, or http only for localhost / 127.0.0.1 (local development). Returns the origin, or null. */
export function cleanDashboard(value) {
  try {
    const u = new URL(String(value).trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol === "https:" || (u.protocol === "http:" && local)) return u.origin;
  } catch {
    // fall through
  }
  return null;
}

export async function getDashboard() {
  const { dashboard } = await chrome.storage.sync.get("dashboard");
  return cleanDashboard(dashboard) ?? DEFAULT_DASHBOARD;
}

export async function setDashboard(value) {
  const origin = cleanDashboard(value);
  if (!origin) throw new Error("Use your dashboard's https:// address (or http://localhost for development).");
  await chrome.storage.sync.set({ dashboard: origin });
  return origin;
}
