/**
 * authenticateNewRequest with the TokenStore Durable Object involved:
 * store-issued bearer tokens resolve to their owner's email, revoked
 * tokens are rejected, and env-map tokens keep working alongside.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStoreFetch } = vi.hoisted(() => ({
  mockStoreFetch: vi.fn(),
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockStoreFetch }),
}));

import { authenticateNewRequest, type AuthEnv } from "~/lib/auth.server";

function bearerRequest(token?: string) {
  return new Request("https://mist.example.com/new", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: "# Doc",
  });
}

/** Emulate the store: one known token belonging to alice. */
function storeKnows(tokens: Record<string, string>) {
  mockStoreFetch.mockImplementation(async (req: Request) => {
    const { token } = (await req.json()) as { token: string };
    const email = tokens[token];
    return email
      ? new Response(JSON.stringify({ ok: true, email }), { status: 200 })
      : new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
}

describe("authenticateNewRequest with TokenStore", () => {
  let env: AuthEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    env = {
      // SSO on so auth is enforced even without env-map tokens
      ONELOGIN_SUBDOMAIN: "vio",
      ONELOGIN_CLIENT_ID: "client",
      ONELOGIN_CLIENT_SECRET: "secret",
      SESSION_SECRET: "session-secret",
      TokenStore: {},
    };
  });

  it("accepts a store-issued token and returns its owner", async () => {
    storeKnows({ mist_good: "alice@vio.com" });

    const result = await authenticateNewRequest(bearerRequest("mist_good"), env);
    expect(result).toEqual({ ok: true, email: "alice@vio.com" });
  });

  it("rejects a token the store does not know (e.g. revoked)", async () => {
    storeKnows({});

    const result = await authenticateNewRequest(bearerRequest("mist_gone"), env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("invalid API token");
  });

  it("prefers the env map and skips the store for env tokens", async () => {
    env.MIST_API_TOKENS = '{"envtok":"bob@vio.com"}';
    storeKnows({});

    const result = await authenticateNewRequest(bearerRequest("envtok"), env);
    expect(result).toEqual({ ok: true, email: "bob@vio.com" });
    expect(mockStoreFetch).not.toHaveBeenCalled();
  });

  it("falls back to the store when the env map misses", async () => {
    env.MIST_API_TOKENS = '{"envtok":"bob@vio.com"}';
    storeKnows({ mist_good: "alice@vio.com" });

    const result = await authenticateNewRequest(bearerRequest("mist_good"), env);
    expect(result).toEqual({ ok: true, email: "alice@vio.com" });
  });

  it("treats a broken store as an unknown token, not an error", async () => {
    mockStoreFetch.mockRejectedValue(new Error("store down"));

    const result = await authenticateNewRequest(bearerRequest("mist_good"), env);
    expect(result.ok).toBe(false);
  });

  it("skips the store entirely when the binding is absent", async () => {
    delete env.TokenStore;

    const result = await authenticateNewRequest(bearerRequest("mist_good"), env);
    expect(result.ok).toBe(false);
    expect(mockStoreFetch).not.toHaveBeenCalled();
  });
});
