import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, unknown>,
}));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockImplementation(() => ({ env: mockEnv })),
}));

vi.mock("react-router", () => ({
  redirect: (url: string, init?: ResponseInit) =>
    new Response(null, {
      status: 302,
      headers: { Location: url, ...(init?.headers as Record<string, string>) },
    }),
}));

import { loader } from "~/routes/auth.logout";

const context = {} as Parameters<typeof loader>[0]["context"];

function logoutRequest() {
  return new Request("https://mist.example.com/auth/logout");
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

  it("redirects to the OneLogin end-session endpoint when SSO is on", () => {
    mockEnv.ONELOGIN_SUBDOMAIN = "vio";
    mockEnv.ONELOGIN_CLIENT_ID = "client-1";
    mockEnv.ONELOGIN_CLIENT_SECRET = "secret";
    mockEnv.SESSION_SECRET = "session-secret";

    const response = loader({ request: logoutRequest(), context } as Parameters<
      typeof loader
    >[0]) as Response;

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin).toBe("https://vio.onelogin.com");
    expect(location.pathname).toBe("/oidc/2/logout");
    expect(location.searchParams.get("client_id")).toBe("client-1");
    expect(location.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://mist.example.com/",
    );
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
