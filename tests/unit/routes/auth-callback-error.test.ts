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

import { loader } from "~/routes/auth.callback";

const context = {} as Parameters<typeof loader>[0]["context"];

function callbackRequest(query: string) {
  return new Request(`https://mist.example.com/auth/callback${query}`);
}

async function runLoader(query: string) {
  return (await loader({
    request: callbackRequest(query),
    context,
  } as Parameters<typeof loader>[0])) as Response;
}

describe("GET /auth/callback error handling", () => {
  beforeEach(() => {
    mockEnv.ONELOGIN_SUBDOMAIN = "vio";
    mockEnv.ONELOGIN_CLIENT_ID = "client-1";
    mockEnv.ONELOGIN_CLIENT_SECRET = "secret";
    mockEnv.SESSION_SECRET = "session-secret";
  });

  it("renders a 403 page for access_denied with the description", async () => {
    const response = await runLoader(
      "?error=access_denied&error_description=End-user%20does%20not%20have%20access%20to%20this%20application&state=abc",
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("access_denied");
    expect(body).toContain("End-user does not have access to this application");
    expect(body).toContain('href="/auth/login"');
    expect(body).toContain("assigned");
  });

  it("clears the OIDC state cookie on error", async () => {
    const response = await runLoader("?error=access_denied&state=abc");

    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toContain("mist_oidc=;");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("returns 400 for non-access_denied errors", async () => {
    const response = await runLoader("?error=server_error");

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("server_error");
  });

  it("escapes HTML in attacker-influenced params", async () => {
    const response = await runLoader(
      "?error=access_denied&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    );

    const body = await response.text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("returns a clean 400 page when neither code nor error is present", async () => {
    const response = await runLoader("");

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("invalid_callback");
    expect(body).toContain('href="/auth/login"');
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("redirects home when SSO is not configured", async () => {
    delete mockEnv.ONELOGIN_SUBDOMAIN;
    delete mockEnv.ONELOGIN_CLIENT_ID;
    delete mockEnv.ONELOGIN_CLIENT_SECRET;
    delete mockEnv.SESSION_SECRET;

    const response = await runLoader("?error=access_denied");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
  });
});
