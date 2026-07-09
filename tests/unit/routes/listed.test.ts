// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAgentFetch, mockEnv } = vi.hoisted(() => ({
  mockAgentFetch: vi.fn(),
  mockEnv: { DocumentAgent: {} } as Record<string, unknown>,
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockAgentFetch }),
}));

import { handleListedUpdate } from "~/lib/update.server";

function listedRequest(
  idParam: string,
  body: string,
  headers?: Record<string, string>,
) {
  return new Request(`https://mist.example.com/docs/${idParam}/listed`, {
    method: "POST",
    body,
    headers,
  });
}

describe("POST /docs/:id/listed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, listed: true }), { status: 200 }),
    );
    delete mockEnv.MIST_API_TOKENS;
    delete mockEnv.ONELOGIN_SUBDOMAIN;
    delete mockEnv.ONELOGIN_CLIENT_ID;
    delete mockEnv.ONELOGIN_CLIENT_SECRET;
    delete mockEnv.SESSION_SECRET;
  });

  it("sets the flag and returns the resulting state", async () => {
    const res = await handleListedUpdate(
      listedRequest("abcd1234", JSON.stringify({ listed: true })),
      mockEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, listed: true });

    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.method).toBe("POST");
    expect(new URL(agentRequest.url).pathname).toBe("/listed");
    expect(await agentRequest.json()).toEqual({ listed: true });
  });

  it("returns 401 when tokens are configured and none is given", async () => {
    mockEnv.MIST_API_TOKENS = '{"s3cret":"alice@vio.com"}';
    const res = await handleListedUpdate(
      listedRequest("abcd1234", JSON.stringify({ listed: true })),
      mockEnv,
    );
    expect(res.status).toBe(401);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("accepts a title-aliased path and addresses the canonical doc", async () => {
    const res = await handleListedUpdate(
      listedRequest("my-title-abcd1234.md", JSON.stringify({ listed: false })),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const { getAgentByName } = await import("agents");
    const lastCall = vi.mocked(getAgentByName).mock.calls.at(-1)!;
    expect(lastCall[1]).toBe("abcd1234");
  });

  it("returns 404 for an invalid id", async () => {
    const res = await handleListedUpdate(
      listedRequest("!bad!", JSON.stringify({ listed: true })),
      mockEnv,
    );
    expect(res.status).toBe(404);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("relays the document's 400 for a malformed body", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: 'body must be {"listed": true|false}' }),
        { status: 400 },
      ),
    );
    const res = await handleListedUpdate(
      listedRequest("abcd1234", "not json"),
      mockEnv,
    );
    expect(res.status).toBe(400);
  });
});
