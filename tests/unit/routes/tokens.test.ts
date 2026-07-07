/**
 * /tokens loader + action: session gating and email scoping. The token
 * store is mocked; identity comes from real signed session cookies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStoreFetch, mockEnv } = vi.hoisted(() => ({
  mockStoreFetch: vi.fn(),
  mockEnv: {} as Record<string, unknown>,
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockStoreFetch }),
}));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockImplementation(() => ({ env: mockEnv })),
}));

vi.mock("react-router", () => ({
  redirect: (url: string) =>
    new Response(null, { status: 302, headers: { Location: url } }),
  Form: () => null,
  Link: () => null,
  useNavigation: () => ({ state: "idle" }),
}));

import { loader, action } from "~/routes/tokens";
import { createSessionCookie } from "~/lib/auth.server";

const SECRET = "test-session-secret";
const context = {} as Parameters<typeof loader>[0]["context"];

async function sessionCookie(email: string): Promise<string> {
  const setCookie = await createSessionCookie(email, SECRET);
  return setCookie.split(";")[0];
}

function request(cookie?: string, form?: Record<string, string>) {
  const init: RequestInit = { method: form ? "POST" : "GET" };
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (form) {
    const params = new URLSearchParams(form);
    init.body = params;
  }
  init.headers = headers;
  return new Request("https://mist.example.com/tokens", init);
}

describe("/tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockEnv)) delete mockEnv[key];
    mockEnv.SESSION_SECRET = SECRET;
    mockEnv.ONELOGIN_SUBDOMAIN = "vio";
    mockEnv.ONELOGIN_CLIENT_ID = "client";
    mockEnv.ONELOGIN_CLIENT_SECRET = "secret";
    mockEnv.TokenStore = {};
    mockStoreFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, tokens: [] }), { status: 200 }),
    );
  });

  it("loader redirects to login without a session when SSO is on", async () => {
    try {
      await loader({ request: request(), context, params: {} } as Parameters<
        typeof loader
      >[0]);
      expect.unreachable("loader should throw a redirect");
    } catch (thrown) {
      const response = thrown as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toContain("/auth/login");
    }
  });

  it("loader renders a notice instead of redirecting when SSO is off", async () => {
    delete mockEnv.ONELOGIN_SUBDOMAIN;

    const data = await loader({
      request: request(),
      context,
      params: {},
    } as Parameters<typeof loader>[0]);
    expect(data).toEqual({ email: null, tokens: [] });
  });

  it("loader lists tokens for the session email", async () => {
    const cookie = await sessionCookie("alice@vio.com");
    await loader({ request: request(cookie), context, params: {} } as Parameters<
      typeof loader
    >[0]);

    const storeRequest = mockStoreFetch.mock.calls[0][0] as Request;
    expect(new URL(storeRequest.url).pathname).toBe("/list");
    expect(await storeRequest.json()).toEqual({ email: "alice@vio.com" });
  });

  it("action rejects unauthenticated requests", async () => {
    try {
      await action({
        request: request(undefined, { intent: "create", label: "x" }),
        context,
        params: {},
      } as Parameters<typeof action>[0]);
      expect.unreachable("action should throw 403");
    } catch (thrown) {
      expect((thrown as Response).status).toBe(403);
    }
    expect(mockStoreFetch).not.toHaveBeenCalled();
  });

  it("action creates a token scoped to the session email", async () => {
    mockStoreFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          token: "mist_abc",
          info: { id: "h", label: "cli", prefix: "mist_abc", createdAt: 1 },
        }),
        { status: 200 },
      ),
    );

    const cookie = await sessionCookie("alice@vio.com");
    const data = await action({
      request: request(cookie, { intent: "create", label: "cli" }),
      context,
      params: {},
    } as Parameters<typeof action>[0]);

    expect(data).toEqual({ created: "mist_abc", label: "cli" });
    const storeRequest = mockStoreFetch.mock.calls[0][0] as Request;
    expect(new URL(storeRequest.url).pathname).toBe("/create");
    expect(await storeRequest.json()).toEqual({
      email: "alice@vio.com",
      label: "cli",
    });
  });

  it("action revoke and rename carry the session email, not a form value", async () => {
    const cookie = await sessionCookie("alice@vio.com");

    await action({
      request: request(cookie, {
        intent: "revoke",
        id: "some-hash",
        email: "mallory@vio.com", // must be ignored
      }),
      context,
      params: {},
    } as Parameters<typeof action>[0]);

    let storeRequest = mockStoreFetch.mock.calls[0][0] as Request;
    expect(new URL(storeRequest.url).pathname).toBe("/revoke");
    expect(await storeRequest.json()).toEqual({
      email: "alice@vio.com",
      id: "some-hash",
    });

    await action({
      request: request(cookie, {
        intent: "rename",
        id: "some-hash",
        label: "new name",
      }),
      context,
      params: {},
    } as Parameters<typeof action>[0]);

    storeRequest = mockStoreFetch.mock.calls[1][0] as Request;
    expect(new URL(storeRequest.url).pathname).toBe("/rename");
    expect(await storeRequest.json()).toEqual({
      email: "alice@vio.com",
      id: "some-hash",
      label: "new name",
    });
  });

  it("action rejects an empty rename label", async () => {
    const cookie = await sessionCookie("alice@vio.com");
    const data = await action({
      request: request(cookie, { intent: "rename", id: "h", label: "  " }),
      context,
      params: {},
    } as Parameters<typeof action>[0]);

    expect(data).toEqual({ error: "label must not be empty" });
    expect(mockStoreFetch).not.toHaveBeenCalled();
  });
});
