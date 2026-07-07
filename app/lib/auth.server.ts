/**
 * Authentication for MIST.
 *
 * Two mechanisms share a single notion of identity — an email address:
 *
 * 1. OneLogin OIDC (authorization code + PKCE) for browser users.
 *    The resulting identity lives in a signed, HttpOnly session cookie —
 *    no server-side session store is needed because the cookie carries
 *    the email and expiry, authenticated by an HMAC signature.
 *
 * 2. Bearer tokens for programmatic submission (`curl -T file.md /new`).
 *    MIST_API_TOKENS maps each token to the submitter's email, either as
 *    JSON (`{"<token>": "user@vio.com"}`) or as comma-separated
 *    `token:email` pairs.
 *
 * Everything here relies only on Web APIs (WebCrypto, fetch), so it runs
 * unchanged in Cloudflare Workers and in plain Vitest.
 */

import { TOKEN_STORE_AGENT_NAME } from "~/shared/constants";

export interface AuthEnv {
  ONELOGIN_SUBDOMAIN?: string;
  ONELOGIN_CLIENT_ID?: string;
  ONELOGIN_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  MIST_API_TOKENS?: string;
  /** Durable Object namespace holding user-issued API tokens. */
  TokenStore?: unknown;
}

export const SESSION_COOKIE = "mist_session";
export const OIDC_COOKIE = "mist_oidc";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // one week
export const OIDC_STATE_MAX_AGE_SECONDS = 10 * 60; // login round-trip window

/* ------------------------------------------------------------------ */
/*  Configuration checks                                               */
/* ------------------------------------------------------------------ */

/** SSO needs all OneLogin credentials plus a secret to sign sessions with. */
export function isSsoConfigured(env: AuthEnv): boolean {
  return Boolean(
    env.ONELOGIN_SUBDOMAIN &&
      env.ONELOGIN_CLIENT_ID &&
      env.ONELOGIN_CLIENT_SECRET &&
      env.SESSION_SECRET,
  );
}

export function isAuthConfigured(env: AuthEnv): boolean {
  return isSsoConfigured(env) || parseApiTokens(env.MIST_API_TOKENS).size > 0;
}

/* ------------------------------------------------------------------ */
/*  Base64url helpers                                                  */
/* ------------------------------------------------------------------ */

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ------------------------------------------------------------------ */
/*  Signed payloads (HMAC-SHA256)                                      */
/* ------------------------------------------------------------------ */

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Produce `base64url(json).base64url(hmac)` — the cookie value format. */
export async function signPayload(payload: object, secret: string): Promise<string> {
  const data = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/**
 * Verify signature and expiry; returns the payload or null. Expiry is a
 * required `exp` field (unix seconds) inside the payload itself, so a
 * stolen cookie cannot outlive its window even if cookie attributes are
 * stripped.
 */
export async function verifyPayload<T extends { exp: number }>(
  token: string,
  secret: string,
): Promise<T | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let valid = false;
  try {
    const key = await hmacKey(secret);
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(sig) as BufferSource,
      new TextEncoder().encode(data),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(data))) as T;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Session cookie                                                     */
/* ------------------------------------------------------------------ */

export interface SessionPayload {
  email: string;
  exp: number;
}

export async function createSessionCookie(email: string, secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const value = await signPayload({ email, exp } satisfies SessionPayload, secret);
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Email of the signed-in browser user, or null. */
export async function getSessionEmail(request: Request, env: AuthEnv): Promise<string | null> {
  if (!env.SESSION_SECRET) return null;
  const cookie = getCookie(request, SESSION_COOKIE);
  if (!cookie) return null;
  const payload = await verifyPayload<SessionPayload>(cookie, env.SESSION_SECRET);
  return payload?.email ?? null;
}

/* ------------------------------------------------------------------ */
/*  API tokens                                                         */
/* ------------------------------------------------------------------ */

/**
 * MIST_API_TOKENS accepts two shapes:
 *   JSON object:      {"s3cret1": "alice@vio.com", "s3cret2": "bob@vio.com"}
 *   token:email CSV:  s3cret1:alice@vio.com,s3cret2:bob@vio.com
 */
export function parseApiTokens(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw || !raw.trim()) return map;

  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      for (const [token, email] of Object.entries(obj)) {
        if (token && typeof email === "string" && email) map.set(token, email);
      }
    } catch {
      // malformed JSON — treat as no tokens configured
    }
    return map;
  }

  for (const pair of trimmed.split(",")) {
    const sep = pair.indexOf(":");
    if (sep <= 0) continue;
    const token = pair.slice(0, sep).trim();
    const email = pair.slice(sep + 1).trim();
    if (token && email) map.set(token, email);
  }
  return map;
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/* ------------------------------------------------------------------ */
/*  /new authentication                                                */
/* ------------------------------------------------------------------ */

export type ApiAuthResult =
  | { ok: true; email: string | null }
  | { ok: false; message: string };

/**
 * Resolve a bearer token to an email via the TokenStore Durable Object.
 * Returns null when the binding is absent (tests, plain dev) or the
 * token is unknown; the store itself hashes the token before lookup.
 */
async function lookupStoreToken(
  token: string,
  env: AuthEnv,
): Promise<string | null> {
  if (!env.TokenStore) return null;
  try {
    const { getAgentByName } = await import("agents");
    const store = await getAgentByName(
      env.TokenStore as Parameters<typeof getAgentByName>[0],
      TOKEN_STORE_AGENT_NAME,
    );
    const res = await store.fetch(
      new Request("https://tokens/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { email?: string };
    return typeof body.email === "string" && body.email ? body.email : null;
  } catch {
    // A broken token store must not take document creation down with it.
    return null;
  }
}

/**
 * Decide whether a document-creation request may proceed and which email
 * to record as the author. Order of preference: bearer token, browser
 * session, open access (when no auth is configured at all).
 */
export async function authenticateNewRequest(
  request: Request,
  env: AuthEnv,
): Promise<ApiAuthResult> {
  const tokens = parseApiTokens(env.MIST_API_TOKENS);
  const sso = isSsoConfigured(env);

  // Local dev / upstream parity: nothing configured, stay open.
  if (tokens.size === 0 && !sso) return { ok: true, email: null };

  const bearer = getBearerToken(request);
  if (bearer !== null) {
    const email = tokens.get(bearer) ?? (await lookupStoreToken(bearer, env));
    if (email) return { ok: true, email };
    return { ok: false, message: "invalid API token" };
  }

  if (sso) {
    const email = await getSessionEmail(request, env);
    if (email) return { ok: true, email };
  }

  return {
    ok: false,
    message:
      'authentication required — pass "Authorization: Bearer <token>" or sign in via the web UI',
  };
}

/* ------------------------------------------------------------------ */
/*  Page gating                                                        */
/* ------------------------------------------------------------------ */

/**
 * Should an unauthenticated request to this path be redirected to login?
 * Agent traffic (Yjs WebSocket), the auth routes themselves, and /new
 * (which does its own token/session check) are exempt.
 */
export function requiresLogin(pathname: string): boolean {
  if (pathname.startsWith("/agents/")) return false;
  if (pathname.startsWith("/auth/")) return false;
  if (pathname === "/new") return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  OneLogin OIDC                                                      */
/* ------------------------------------------------------------------ */

export interface OidcStatePayload {
  state: string;
  verifier: string;
  redirect: string;
  exp: number;
}

export function oidcIssuer(subdomain: string): string {
  return `https://${subdomain}.onelogin.com/oidc/2`;
}

function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) };
}

export function generateState(): string {
  return randomToken(16);
}

export function buildAuthorizeUrl(options: {
  subdomain: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(`${oidcIssuer(options.subdomain)}/auth`);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Exchange the authorization code for tokens at OneLogin's token endpoint. */
export async function exchangeCode(options: {
  subdomain: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<{ id_token: string }> {
  const doFetch = options.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
  });

  // OneLogin's default token-endpoint auth method is client_secret_basic
  const basic = btoa(`${options.clientId}:${options.clientSecret}`);
  const res = await doFetch(`${oidcIssuer(options.subdomain)}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`token exchange failed with status ${res.status}`);
  }

  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) {
    throw new Error("token response missing id_token");
  }
  return { id_token: json.id_token };
}

interface IdTokenClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  email?: string;
  preferred_username?: string;
  [key: string]: unknown;
}

/**
 * Verify an RS256 ID token against the issuer's JWKS and return the
 * user's email. Checks signature, issuer, audience, and expiry.
 */
export async function verifyIdToken(options: {
  idToken: string;
  issuer: string;
  clientId: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const doFetch = options.fetchImpl ?? fetch;
  const parts = options.idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed ID token");

  const header = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(parts[0])),
  ) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") throw new Error(`unsupported ID token alg: ${header.alg}`);

  const jwksRes = await doFetch(`${options.issuer}/certs`);
  if (!jwksRes.ok) throw new Error(`failed to fetch JWKS (status ${jwksRes.status})`);
  const jwks = (await jwksRes.json()) as { keys: (JsonWebKey & { kid?: string })[] };

  const jwk =
    jwks.keys.find((k) => header.kid && k.kid === header.kid) ??
    (jwks.keys.length === 1 ? jwks.keys[0] : undefined);
  if (!jwk) throw new Error("no matching JWKS key for ID token");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(parts[2]) as BufferSource,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new Error("ID token signature verification failed");

  const claims = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(parts[1])),
  ) as IdTokenClaims;

  if (claims.iss !== options.issuer) throw new Error("ID token issuer mismatch");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(options.clientId)) throw new Error("ID token audience mismatch");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) {
    throw new Error("ID token expired");
  }

  const email = claims.email ?? claims.preferred_username;
  if (!email || typeof email !== "string") {
    throw new Error("ID token missing email claim");
  }
  return email;
}
