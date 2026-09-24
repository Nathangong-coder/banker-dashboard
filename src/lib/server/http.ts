import "server-only";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown) {
  const status = e instanceof HttpError ? e.status : 500;
  const message = e instanceof Error ? e.message : "Unexpected error";
  return Response.json({ error: message }, { status });
}

/** User-supplied base URLs must be public https endpoints (blocks SSRF into private networks). */
export function assertPublicHttps(raw: string, label = "URL") {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, `${label} is not a valid URL.`);
  }
  const h = u.hostname.toLowerCase();
  const privateHost =
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === "[::1]" ||
    /^\[(fc|fd|fe80)/.test(h);
  if (u.protocol !== "https:" || privateHost) throw new HttpError(400, `${label} must be a public https:// address.`);
  return u;
}
