/**
 * OAuth 2.1 authorization server for MCP clients.
 *
 * Users sign in through the instance's OIDC provider (the ordinary
 * session), approve the client on a consent page, and the client
 * receives a regular mist API token — listed on /tokens and revocable
 * there like any other.
 *
 * Nothing is stored until the token is issued: client registrations,
 * pending consent requests and authorization codes are all signed
 * payloads, so they cannot be forged and expire on their own.
 */
import { getAgentByName } from "agents";
import { TOKEN_STORE_AGENT_NAME } from "~/shared/constants";
import {
  base64UrlEncode,
  externalUrl,
  getSessionEmail,
  isSsoConfigured,
  signPayload,
  verifyPayload,
  type AuthEnv,
} from "~/lib/auth.server";
import { escapeHtml } from "~/lib/render-pages";

export const MCP_PATH = "/mcp";
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
export const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";
export const REGISTER_PATH = "/oauth/register";
export const AUTHORIZE_PATH = "/oauth/authorize";
export const TOKEN_PATH = "/oauth/token";

const CLIENT_MAX_AGE_SECONDS = 10 * 365 * 24 * 60 * 60;
const CONSENT_MAX_AGE_SECONDS = 10 * 60;
const CODE_MAX_AGE_SECONDS = 5 * 60;

interface ClientPayload {
  kind: "mcp-client";
  /** Keeps every registration distinct, even with identical metadata. */
  nonce: string;
  name: string;
  redirectUris: string[];
  exp: number;
}

interface ConsentPayload {
  kind: "mcp-consent";
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  exp: number;
}

interface CodePayload {
  kind: "mcp-code";
  email: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  exp: number;
}

/** OAuth artefacts are signed apart from session cookies, so neither passes for the other. */
function oauthSecret(env: AuthEnv): string {
  return `${env.SESSION_SECRET}\u0000mcp-oauth`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

/**
 * Redirect targets a client may register: https anywhere, http only on
 * the loopback interface, and app-specific schemes of native clients.
 */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }
  return !["javascript:", "data:", "file:", "vbscript:", "blob:"].includes(url.protocol);
}

async function sha256Base64Url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64UrlEncode(new Uint8Array(digest));
}

async function readClient(clientId: string, env: AuthEnv): Promise<ClientPayload | null> {
  const client = await verifyPayload<ClientPayload>(clientId, oauthSecret(env));
  return client?.kind === "mcp-client" ? client : null;
}

/** Does this request belong to the MCP authorization flow? */
export function isMcpOAuthPath(pathname: string): boolean {
  return (
    pathname === PROTECTED_RESOURCE_PATH ||
    pathname === `${PROTECTED_RESOURCE_PATH}${MCP_PATH}` ||
    pathname === AUTHORIZATION_SERVER_PATH ||
    pathname === REGISTER_PATH ||
    pathname === AUTHORIZE_PATH ||
    pathname === TOKEN_PATH
  );
}

/** Where MCP clients learn how to obtain a token for /mcp. */
export function protectedResourceMetadataUrl(request: Request): string {
  return `${externalUrl(request).origin}${PROTECTED_RESOURCE_PATH}${MCP_PATH}`;
}

export async function handleMcpOAuthRequest(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  // Without OIDC there is nobody to sign in; API tokens remain the way in.
  if (!isSsoConfigured(env)) {
    return oauthError("unsupported", "sign-in is not configured on this instance", 404);
  }

  const origin = externalUrl(request).origin;
  switch (url.pathname) {
    case PROTECTED_RESOURCE_PATH:
    case `${PROTECTED_RESOURCE_PATH}${MCP_PATH}`:
      return json({
        resource: `${origin}${MCP_PATH}`,
        authorization_servers: [origin],
        bearer_methods_supported: ["header"],
      });
    case AUTHORIZATION_SERVER_PATH:
      return json({
        issuer: origin,
        authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
        token_endpoint: `${origin}${TOKEN_PATH}`,
        registration_endpoint: `${origin}${REGISTER_PATH}`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    case REGISTER_PATH:
      return request.method === "POST"
        ? register(request, env)
        : oauthError("invalid_request", "use POST", 405);
    case AUTHORIZE_PATH:
      if (request.method === "GET") return authorize(request, env);
      if (request.method === "POST") return consent(request, env);
      return oauthError("invalid_request", "use GET or POST", 405);
    case TOKEN_PATH:
      return request.method === "POST"
        ? token(request, env)
        : oauthError("invalid_request", "use POST", 405);
    default:
      return oauthError("invalid_request", "not found", 404);
  }
}

/** Dynamic client registration: the client id is its own signed record. */
async function register(request: Request, env: AuthEnv): Promise<Response> {
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return oauthError("invalid_client_metadata", "body must be JSON");
  }
  const uris = body.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    !uris.every((u): u is string => typeof u === "string" && isAllowedRedirectUri(u))
  ) {
    return oauthError("invalid_redirect_uri", "redirect_uris must be https, loopback http, or app URIs");
  }
  const name =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 100)
      : "MCP client";

  const clientId = await signPayload(
    {
      kind: "mcp-client",
      nonce: base64UrlEncode(crypto.getRandomValues(new Uint8Array(12))),
      name,
      redirectUris: uris,
      exp: nowSeconds() + CLIENT_MAX_AGE_SECONDS,
    } satisfies ClientPayload,
    oauthSecret(env),
  );
  return json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

function redirectWith(redirectUri: string, params: Record<string, string | null>): Response {
  const target = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) target.searchParams.set(key, value);
  }
  return new Response(null, { status: 302, headers: { Location: target.toString() } });
}

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 34rem;
         margin: 4rem auto; padding: 0 1rem; line-height: 1.6;
         background: #fafaf8; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  code { background: #ececea; padding: .1em .3em; }
  .actions { display: flex; gap: .75rem; margin-top: 1.5rem; }
  button { font: inherit; text-transform: uppercase; letter-spacing: .05em;
           font-size: .85rem; padding: .4rem 1rem; cursor: pointer;
           border: 1px solid #1a1a1a; background: #1a1a1a; color: #fafaf8; }
  button.secondary { background: none; color: inherit; border-color: #ccc; }
  @media (prefers-color-scheme: dark) {
    body { background: #161615; color: #e8e8e6; }
    code { background: #2a2a28; }
    button { background: #e8e8e6; color: #161615; border-color: #e8e8e6; }
    button.secondary { background: none; color: inherit; border-color: #444; }
  }
</style>
</head>
<body>
${body}
</body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // The consent page must never be framed (clickjacking).
        "Content-Security-Policy": "frame-ancestors 'none'",
        "X-Frame-Options": "DENY",
      },
    },
  );
}

/** Ask the signed-in user to approve the client. */
async function authorize(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";

  // Until the client and its redirect target check out, errors are shown
  // here rather than sent anywhere.
  const client = await readClient(clientId, env);
  if (!client) {
    return page("Unknown application", "<h1>Unknown application</h1><p>The application is not registered with mist. Try connecting it again.</p>", 400);
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return page("Invalid redirect", "<h1>Invalid redirect</h1><p>The application asked to return to an address it did not register.</p>", 400);
  }

  const state = params.get("state");
  if (params.get("response_type") !== "code") {
    return redirectWith(redirectUri, { error: "unsupported_response_type", state });
  }
  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge || params.get("code_challenge_method") !== "S256") {
    return redirectWith(redirectUri, {
      error: "invalid_request",
      error_description: "PKCE with S256 is required",
      state,
    });
  }

  const email = await getSessionEmail(request, env);
  if (!email) {
    const back = url.pathname + url.search;
    return new Response(null, {
      status: 302,
      headers: { Location: `/auth/login?redirect=${encodeURIComponent(back)}` },
    });
  }

  const consentRequest = await signPayload(
    {
      kind: "mcp-consent",
      clientId,
      redirectUri,
      codeChallenge,
      state,
      exp: nowSeconds() + CONSENT_MAX_AGE_SECONDS,
    } satisfies ConsentPayload,
    oauthSecret(env),
  );
  const target = new URL(redirectUri);
  const destination = target.protocol.startsWith("http") ? target.host : target.protocol;

  return page(
    "Connect to mist",
    `<h1>Connect ${escapeHtml(client.name)} to mist?</h1>
<p><strong>${escapeHtml(client.name)}</strong> will be able to read, publish and update
documents and resolve comments as <strong>${escapeHtml(email)}</strong>.</p>
<p>After approval you return to <code>${escapeHtml(destination)}</code>.
The access appears on your <a href="/tokens">API tokens</a> page, where it can be revoked.</p>
<form method="post" action="${AUTHORIZE_PATH}">
  <input type="hidden" name="request" value="${escapeHtml(consentRequest)}">
  <div class="actions">
    <button type="submit" name="decision" value="allow">Allow</button>
    <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
  </div>
</form>`,
  );
}

/** The user's answer on the consent page. */
async function consent(request: Request, env: AuthEnv): Promise<Response> {
  // SameSite=Lax keeps the session cookie off cross-site form posts, so
  // only a submission from the consent page itself gets this far.
  const email = await getSessionEmail(request, env);
  if (!email) {
    return page("Signed out", "<h1>Signed out</h1><p>Sign in and connect the application again.</p>", 401);
  }

  const form = await request.formData();
  const pending = await verifyPayload<ConsentPayload>(
    String(form.get("request") ?? ""),
    oauthSecret(env),
  );
  if (pending?.kind !== "mcp-consent" || !(await readClient(pending.clientId, env))) {
    return page("Request expired", "<h1>Request expired</h1><p>Connect the application again.</p>", 400);
  }

  if (form.get("decision") !== "allow") {
    return redirectWith(pending.redirectUri, { error: "access_denied", state: pending.state });
  }

  const code = await signPayload(
    {
      kind: "mcp-code",
      email,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      exp: nowSeconds() + CODE_MAX_AGE_SECONDS,
    } satisfies CodePayload,
    oauthSecret(env),
  );
  return redirectWith(pending.redirectUri, {
    code,
    state: pending.state,
    iss: externalUrl(request).origin,
  });
}

async function readTokenForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("Content-Type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(body).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  }
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

/** Exchange an authorization code for a mist API token. */
async function token(request: Request, env: AuthEnv): Promise<Response> {
  let form: Record<string, string>;
  try {
    form = await readTokenForm(request);
  } catch {
    return oauthError("invalid_request", "malformed body");
  }
  if (form.grant_type !== "authorization_code") {
    return oauthError("unsupported_grant_type", "only authorization_code is supported");
  }

  const code = await verifyPayload<CodePayload>(form.code ?? "", oauthSecret(env));
  if (
    code?.kind !== "mcp-code" ||
    code.clientId !== form.client_id ||
    code.redirectUri !== form.redirect_uri
  ) {
    return oauthError("invalid_grant", "authorization code is invalid or expired");
  }
  if (!form.code_verifier || (await sha256Base64Url(form.code_verifier)) !== code.codeChallenge) {
    return oauthError("invalid_grant", "code_verifier does not match");
  }
  const client = await readClient(code.clientId, env);
  if (!client) {
    return oauthError("invalid_client", "client registration is invalid");
  }

  const issued = await issueApiToken(env, code.email, `MCP: ${client.name}`);
  if (!issued) {
    return oauthError("server_error", "could not issue a token", 500);
  }
  return json({ access_token: issued, token_type: "Bearer" });
}

async function issueApiToken(env: AuthEnv, email: string, label: string): Promise<string | null> {
  if (!env.TokenStore) return null;
  try {
    const store = await getAgentByName(
      env.TokenStore as Parameters<typeof getAgentByName>[0],
      TOKEN_STORE_AGENT_NAME,
    );
    const res = await store.fetch(
      new Request("https://tokens/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, label }),
      }),
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: string };
    return body.token ?? null;
  } catch {
    return null;
  }
}
