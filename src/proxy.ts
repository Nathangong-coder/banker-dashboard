import { NextResponse, type NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Abuse protection for the API (the app has no public forms; its API routes are what a bot could hammer): per-IP rate
 * limits in Upstash Redis. QStash's signed job calls and Google's OAuth callback are exempt (shared IPs / one-shot).
 * Without Redis configured (local dev) everything passes.
 */

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;
// Fixed windows: one Redis call per request. The ephemeral cache answers repeat offenders without Redis at all.
const cache = new Map();
const general = redis && new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(120, "1 m"), prefix: "rl:api", ephemeralCache: cache });
// Creating a server account / starting Google sign-in: rare for real users.
const signup = redis && new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(10, "1 h"), prefix: "rl:signup", ephemeralCache: cache });
// Sends a message to an arbitrary channel (ntfy / SMS / WhatsApp): keep it from being an open relay.
const notify = redis && new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(30, "10 m"), prefix: "rl:notify", ephemeralCache: cache });

const EXEMPT = ["/api/server/run-send", "/api/server/tick", "/api/server/google/callback"];

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (!general || EXEMPT.includes(path)) return NextResponse.next();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const limiter = path === "/api/server/google/start" ? signup! : path === "/api/notify" ? notify! : general;
  try {
    const r = await limiter.limit(ip);
    if (!r.success) {
      const retry = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
      return NextResponse.json(
        { error: `Too many requests. Try again in ${retry < 90 ? `${retry} seconds` : `${Math.ceil(retry / 60)} minutes`}.` },
        { status: 429, headers: { "Retry-After": String(retry), "X-RateLimit-Limit": String(r.limit), "X-RateLimit-Remaining": "0" } },
      );
    }
  } catch {
    // Redis down: fail open rather than take the app down with it.
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
