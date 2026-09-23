import { describe, it, expect, vi, beforeEach } from "vitest";

const { tokenCreates } = vi.hoisted(() => ({
  tokenCreates: [] as Array<{ email: string; label: string }>,
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn(async () => ({
    fetch: async (req: Request) => {
      const body = (await req.json()) as { email: string; label: string };
      tokenCreates.push(body);
      return new Response(JSON.stringify({ ok: true, token: "mist_issued" }));
    },
  })),
}));

import { createSessionCookie, base64UrlEncode } from "~/lib/auth.server";
import { handleMcpOAuthRequest, isAllowedRedirectUri } from "~/lib/mcp-oauth.server";

const ORIGIN = "https://mist.example.com";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const env = {
  ONELOGIN_SUBDOMAIN: "vio",
  ONELOGIN_CLIENT_ID: "c",
  ONELOGIN_CLIENT_SECRET: "s",
  SESSION_SECRET: "session-secret",
  TokenStore: {},
};

function send(path: string, init: RequestInit = {}, e: Record<string, unknown> = env) {
  return handleMcpOAuthRequest(new Request(`${ORIGIN}${path}`, init), e);
}

async function sessionCookie(email = "alice@vio.com") {
  return (await createSessionCookie(email, env.SESSION_SECRET)).split(";")[0];
}

async function register(redirectUris: unknown = [REDIRECT]) {
  return send("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: redirectUris }),
  });
}

async function pkce() {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) };
}

function authorizeQuery(clientId: string, challenge: string, overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    ...overrides,
  }).toString();
}

/** Register, sign in, approve: returns what the client holds afterwards. */
async function approve() {
  const { client_id } = (await (await register()).json()) as { client_id: string };
  const { verifier, challenge } = await pkce();
  const cookie = await sessionCookie();
  const consentPage = await send(`/oauth/authorize?${authorizeQuery(client_id, challenge)}`, {
    headers: { Cookie: cookie },
  });
  const pending = (await consentPage.text()).match(/name="request" value="([^"]+)"/)![1];
  const decision = await send("/oauth/authorize", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request: pending, decision: "allow" }).toString(),
  });
  const location = new URL(decision.headers.get("Location")!);
  return { client_id, verifier, location, code: location.searchParams.get("code")! };
}

function exchange(fields: Record<string, string>) {
  return send("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", ...fields }).toString(),
  });
}

beforeEach(() => {
  tokenCreates.length = 0;
});

describe("MCP OAuth metadata", () => {
  it("advertises the authorization server for /mcp", async () => {
    const res = await send("/.well-known/oauth-protected-resource/mcp");
    expect(await res.json()).toMatchObject({
      resource: `${ORIGIN}/mcp`,
      authorization_servers: [ORIGIN],
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("describes a PKCE-only authorization-code server with registration", async () => {
    const res = await send("/.well-known/oauth-authorization-server");
    expect(await res.json()).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("is unavailable without sign-in configured", async () => {
    const res = await send("/.well-known/oauth-authorization-server", {}, {});
    expect(res.status).toBe(404);
  });
});

describe("MCP OAuth flow", () => {
  it("issues a labelled API token for the approving user", async () => {
    const { client_id, verifier, location, code } = await approve();
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("xyz");
    expect(location.searchParams.get("iss")).toBe(ORIGIN);

    const res = await exchange({ code, client_id, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "mist_issued", token_type: "Bearer" });
    expect(tokenCreates).toEqual([{ email: "alice@vio.com", label: "MCP: Claude" }]);
  });

  it("sends a signed-out user through sign-in and back", async () => {
    const { client_id } = (await (await register()).json()) as { client_id: string };
    const query = authorizeQuery(client_id, "challenge");
    const res = await send(`/oauth/authorize?${query}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      `/auth/login?redirect=${encodeURIComponent(`/oauth/authorize?${query}`)}`,
    );
  });

  it("shows who is granting access to which client", async () => {
    const { client_id } = (await (await register()).json()) as { client_id: string };
    const res = await send(`/oauth/authorize?${authorizeQuery(client_id, "c")}`, {
      headers: { Cookie: await sessionCookie() },
    });
    const html = await res.text();
    expect(html).toContain("Connect Claude to mist?");
    expect(html).toContain("alice@vio.com");
    expect(html).toContain("claude.ai");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("returns access_denied when the user declines", async () => {
    const { client_id } = (await (await register()).json()) as { client_id: string };
    const cookie = await sessionCookie();
    const page = await send(`/oauth/authorize?${authorizeQuery(client_id, "c")}`, {
      headers: { Cookie: cookie },
    });
    const pending = (await page.text()).match(/name="request" value="([^"]+)"/)![1];
    const res = await send("/oauth/authorize", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request: pending, decision: "deny" }).toString(),
    });
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.has("code")).toBe(false);
  });

  it("refuses consent submitted without the user's session", async () => {
    const { client_id } = (await (await register()).json()) as { client_id: string };
    const page = await send(`/oauth/authorize?${authorizeQuery(client_id, "c")}`, {
      headers: { Cookie: await sessionCookie() },
    });
    const pending = (await page.text()).match(/name="request" value="([^"]+)"/)![1];
    const res = await send("/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request: pending, decision: "allow" }).toString(),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("Location")).toBeNull();
  });

  it("rejects a wrong code verifier, client or redirect", async () => {
    const { client_id, verifier, code } = await approve();
    const other = ((await (await register()).json()) as { client_id: string }).client_id;
    for (const fields of [
      { code, client_id, redirect_uri: REDIRECT, code_verifier: "wrong" },
      { code, client_id: other, redirect_uri: REDIRECT, code_verifier: verifier },
      { code, client_id, redirect_uri: "https://evil.example/cb", code_verifier: verifier },
      { code: "forged.code", client_id, redirect_uri: REDIRECT, code_verifier: verifier },
    ]) {
      const res = await exchange(fields);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_grant");
    }
    expect(tokenCreates).toEqual([]);
  });

  it("will not redirect to an address the client did not register", async () => {
    const { client_id } = (await (await register()).json()) as { client_id: string };
    const res = await send(
      `/oauth/authorize?${authorizeQuery(client_id, "c", { redirect_uri: "https://evil.example/cb" })}`,
      { headers: { Cookie: await sessionCookie() } },
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Location")).toBeNull();
  });

  it("does not accept forged client ids", async () => {
    const res = await send(`/oauth/authorize?${authorizeQuery("forged.id", "c")}`, {
      headers: { Cookie: await sessionCookie() },
    });
    expect(res.status).toBe(400);
  });

  it("requires PKCE", async () => {
    const { client_id } = (await (await register()).json()) as { client_id: string };
    const res = await send(
      `/oauth/authorize?${authorizeQuery(client_id, "c", { code_challenge_method: "plain" })}`,
      { headers: { Cookie: await sessionCookie() } },
    );
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("error")).toBe("invalid_request");
  });

  it("does not let a session cookie pass for an authorization code", async () => {
    const { client_id, verifier } = await approve();
    const cookieValue = (await sessionCookie()).split("=")[1];
    const res = await exchange({
      code: cookieValue,
      client_id,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    expect(res.status).toBe(400);
  });
});

describe("client registration", () => {
  it("rejects unsafe redirect targets", async () => {
    expect((await register(["javascript:alert(1)"])).status).toBe(400);
    expect((await register(["http://evil.example/cb"])).status).toBe(400);
    expect((await register([])).status).toBe(400);
  });

  it("accepts https, loopback http and native app schemes", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:33418/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:5000/cb")).toBe(true);
    expect(isAllowedRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
    expect(isAllowedRedirectUri("data:text/html,hi")).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });
});
