import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "./http";
import { appUrl, db, loadAccount } from "./accounts";

/**
 * OAuth 2.1 for the Claude connector (api/mcp, owner 2026-10-22). Coverage is its own authorization server: clients
 * (Claude) register themselves (RFC 7591), the user approves on /connect in the browser that holds their Coverage
 * account, and the token endpoint swaps the code (PKCE S256 only) for a 1-hour access token + a 90-day rotating
 * refresh token. Only sha256 of tokens is stored. Turning automatic sending off (deleteAccount) revokes them all.
 */

export const SCOPE = "coverage";
const CODE_TTL = 300;
const ACCESS_TTL = 3600;
const REFRESH_TTL = 90 * 86400;

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created: string;
}
interface CodeGrant {
  acct: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope: string;
}
interface TokenGrant {
  acct: string;
  clientId: string;
  scope: string;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const rand = (n = 32) => randomBytes(n).toString("base64url");
const CLIENT = (id: string) => `oauthclient:${id}`;
const CODE = (c: string) => `oauthcode:${sha(c)}`;
const ACCESS = (t: string) => `oauthat:${sha(t)}`;
const REFRESH = (t: string) => `oauthrt:${sha(t)}`;
/** Set of this account's token keys, so they can all be revoked. */
export const ACCT_TOKENS = (acct: string) => `oauthtok:${acct}`;

export function issuer(req: Request) {
  return appUrl(req);
}
export const resourceUrl = (req: Request) => `${appUrl(req)}/api/mcp`;

export function authServerMetadata(req: Request) {
  const base = issuer(req);
  return {
    issuer: base,
    authorization_endpoint: `${base}/connect`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
    service_documentation: `${base}/privacy`,
  };
}

export function resourceMetadata(req: Request) {
  return {
    resource: resourceUrl(req),
    authorization_servers: [issuer(req)],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Coverage",
  };
}

/** Redirect URIs a client may register: https anywhere, or http on this machine (Claude Code's local callback). */
function okRedirect(u: string) {
  try {
    const x = new URL(u);
    if (x.hash) return false;
    return x.protocol === "https:" || (x.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname));
  } catch {
    return false;
  }
}

export async function registerClient(body: { redirect_uris?: unknown; client_name?: unknown }) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string").slice(0, 10) : [];
  if (!uris.length || !uris.every(okRedirect)) throw new HttpError(400, "invalid_redirect_uri");
  const c: OAuthClient = {
    client_id: `cov_${rand(16)}`,
    client_name: typeof body.client_name === "string" ? body.client_name.slice(0, 100) : "MCP client",
    redirect_uris: uris,
    created: new Date().toISOString(),
  };
  await db().set(CLIENT(c.client_id), c, { ex: 365 * 86400 });
  return c;
}

export async function getClient(id: string) {
  return (await db().get<OAuthClient>(CLIENT(id))) ?? null;
}

/** Check an authorization request before showing the approval screen (and again when it's approved). */
export async function checkAuthRequest(q: { client_id: string; redirect_uri: string; code_challenge: string; code_challenge_method?: string; response_type?: string }) {
  const c = await getClient(q.client_id);
  if (!c) throw new HttpError(400, "Unknown app. Remove the connector in Claude and add it again.");
  if (!c.redirect_uris.includes(q.redirect_uri)) throw new HttpError(400, "That app's return address doesn't match what it registered.");
  if ((q.response_type ?? "code") !== "code") throw new HttpError(400, "unsupported_response_type");
  if ((q.code_challenge_method ?? "S256") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) throw new HttpError(400, "PKCE (S256) is required.");
  return c;
}

export async function issueCode(acct: string, g: Omit<CodeGrant, "acct">) {
  const code = rand();
  await db().set(CODE(code), { ...g, acct }, { ex: CODE_TTL });
  return code;
}

async function issueTokens(g: TokenGrant) {
  const access = `cova_${rand()}`;
  const refresh = `covr_${rand()}`;
  await db().set(ACCESS(access), g, { ex: ACCESS_TTL });
  await db().set(REFRESH(refresh), g, { ex: REFRESH_TTL });
  await db().sadd(ACCT_TOKENS(g.acct), ACCESS(access), REFRESH(refresh));
  await db().expire(ACCT_TOKENS(g.acct), REFRESH_TTL);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: g.scope };
}

/** RFC 6749 errors as the token endpoint must return them (400 + {error}). */
export class OAuthError extends Error {
  constructor(
    public code: string,
    message = code,
  ) {
    super(message);
  }
}

export async function exchange(form: URLSearchParams) {
  const grant = form.get("grant_type");
  const clientId = form.get("client_id") ?? "";
  if (grant === "authorization_code") {
    const code = form.get("code") ?? "";
    const g = await db().getdel<CodeGrant>(CODE(code));
    if (!g) throw new OAuthError("invalid_grant", "Code expired or already used.");
    if (g.clientId !== clientId || g.redirectUri !== (form.get("redirect_uri") ?? "")) throw new OAuthError("invalid_grant", "Client or redirect doesn't match.");
    const verifier = form.get("code_verifier") ?? "";
    if (createHash("sha256").update(verifier).digest("base64url") !== g.challenge) throw new OAuthError("invalid_grant", "PKCE check failed.");
    if (!(await loadAccount(g.acct))) throw new OAuthError("invalid_grant", "Account gone.");
    return issueTokens({ acct: g.acct, clientId, scope: g.scope });
  }
  if (grant === "refresh_token") {
    const rt = form.get("refresh_token") ?? "";
    const g = await db().getdel<TokenGrant>(REFRESH(rt));
    if (!g || (clientId && g.clientId !== clientId)) throw new OAuthError("invalid_grant", "Refresh token expired or revoked.");
    if (!(await loadAccount(g.acct))) throw new OAuthError("invalid_grant", "Account gone.");
    return issueTokens(g);
  }
  throw new OAuthError("unsupported_grant_type");
}

/** The account behind a Bearer access token, or null. */
export async function accountFromBearer(req: Request) {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(cova_[A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const g = await db().get<TokenGrant>(ACCESS(m[1]));
  if (!g) return null;
  return loadAccount(g.acct);
}

export async function revokeToken(token: string) {
  await db().del(ACCESS(token), REFRESH(token));
}
