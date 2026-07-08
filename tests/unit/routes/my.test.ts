/**
 * /my loader: session gating and author scoping. The registry is
 * mocked; identity comes from real signed session cookies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRegistryFetch, mockEnv } = vi.hoisted(() => ({
  mockRegistryFetch: vi.fn(),
  mockEnv: {} as Record<string, unknown>,
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockRegistryFetch }),
}));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockImplementation(() => ({ env: mockEnv })),
}));

vi.mock("react-router", () => ({
  redirect: (url: string) =>
    new Response(null, { status: 302, headers: { Location: url } }),
  Link: () => null,
}));

import { loader } from "~/routes/my";
import { createSessionCookie } from "~/lib/auth.server";

const SECRET = "test-session-secret";
const context = {} as Parameters<typeof loader>[0]["context"];

async function sessionCookie(email: string): Promise<string> {
  const setCookie = await createSessionCookie(email, SECRET);
  return setCookie.split(";")[0];
}

function request(cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  return new Request("https://mist.example.com/my", { headers });
}

describe("/my", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockEnv)) delete mockEnv[key];
    mockEnv.SESSION_SECRET = SECRET;
    mockEnv.ONELOGIN_SUBDOMAIN = "vio";
    mockEnv.ONELOGIN_CLIENT_ID = "client";
    mockEnv.ONELOGIN_CLIENT_SECRET = "secret";
    mockEnv.DocumentRegistry = {};
    mockRegistryFetch.mockResolvedValue(
      new Response(JSON.stringify({ documents: [] }), { status: 200 }),
    );
  });

  it("redirects to login without a session when SSO is on", async () => {
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

  it("renders a notice instead of redirecting when SSO is off", async () => {
    delete mockEnv.ONELOGIN_SUBDOMAIN;

    const data = await loader({
      request: request(),
      context,
      params: {},
    } as Parameters<typeof loader>[0]);
    expect(data).toEqual({ email: null, documents: [] });
  });

  it("queries the registry for the session email only", async () => {
    const docs = [
      {
        id: "a1",
        title: "Mine",
        author: "alice@vio.com",
        listed: false,
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    mockRegistryFetch.mockResolvedValue(
      new Response(JSON.stringify({ documents: docs }), { status: 200 }),
    );

    const cookie = await sessionCookie("alice@vio.com");
    const data = await loader({
      request: request(cookie),
      context,
      params: {},
    } as Parameters<typeof loader>[0]);

    const registryRequest = mockRegistryFetch.mock.calls[0][0] as Request;
    expect(new URL(registryRequest.url).pathname).toBe("/by-author");
    expect(await registryRequest.json()).toEqual({ email: "alice@vio.com" });
    expect(data).toEqual({ email: "alice@vio.com", documents: docs });
  });

  it("renders even when the registry is unavailable", async () => {
    mockRegistryFetch.mockRejectedValue(new Error("boom"));

    const cookie = await sessionCookie("alice@vio.com");
    const data = await loader({
      request: request(cookie),
      context,
      params: {},
    } as Parameters<typeof loader>[0]);
    expect(data).toEqual({ email: "alice@vio.com", documents: [] });
  });
});
