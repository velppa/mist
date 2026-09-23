import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, unknown>,
}));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockImplementation(() => ({ env: mockEnv })),
}));

vi.mock("react-router", () => ({
  redirect: (url: string, init?: ResponseInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Location", url);
    return new Response(null, { status: 302, headers });
  },
}));

import { loader } from "~/routes/auth.logout";

const context = {} as Parameters<typeof loader>[0]["context"];

function logoutRequest(cookie?: string) {
  return new Request("https://mist.example.com/auth/logout", {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe("GET /auth/logout", () => {
  beforeEach(() => {
    delete mockEnv.ONELOGIN_SUBDOMAIN;
    delete mockEnv.ONELOGIN_CLIENT_ID;
    delete mockEnv.ONELOGIN_CLIENT_SECRET;
    delete mockEnv.SESSION_SECRET;
  });

  it("clears the session cookie and redirects home when SSO is off", () => {
    const response = loader({ request: logoutRequest(), context } as Parameters<
      typeof loader
    >[0]) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toContain("mist_session=;");
    expect(setCookie).toContain("Max-Age=0");
  });

  function enableSso() {
    mockEnv.ONELOGIN_SUBDOMAIN = "vio";
    mockEnv.ONELOGIN_CLIENT_ID = "client-1";
    mockEnv.ONELOGIN_CLIENT_SECRET = "secret";
    mockEnv.SESSION_SECRET = "session-secret";
  }

  function runLoader(cookie?: string) {
    return loader({ request: logoutRequest(cookie), context } as Parameters<
      typeof loader
    >[0]) as Response;
  }

  it("redirects back home via the provider when the ID token is known", () => {
    enableSso();

    const response = runLoader("mist_session=abc; mist_id_token=id.tok.en");

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin).toBe("https://vio.onelogin.com");
    expect(location.pathname).toBe("/oidc/2/logout");
    expect(location.searchParams.get("client_id")).toBe("client-1");
    expect(location.searchParams.get("id_token_hint")).toBe("id.tok.en");
    expect(location.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://mist.example.com/",
    );
  });

  it("omits the post-logout redirect without an ID token", () => {
    enableSso();

    const response = runLoader("mist_session=abc");

    const location = new URL(response.headers.get("Location")!);
    expect(location.pathname).toBe("/oidc/2/logout");
    expect(location.searchParams.get("client_id")).toBe("client-1");
    expect(location.searchParams.has("id_token_hint")).toBe(false);
    expect(location.searchParams.has("post_logout_redirect_uri")).toBe(false);
  });

  it("clears both the session and ID token cookies", () => {
    enableSso();

    const cookies = runLoader("mist_id_token=id.tok.en").headers.getSetCookie();

    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^mist_session=;.*Max-Age=0/);
    expect(cookies[1]).toMatch(/^mist_id_token=;.*Path=\/auth;.*Max-Age=0/);
  });
});
