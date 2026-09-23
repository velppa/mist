import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAgentFetch, mockEnv } = vi.hoisted(() => ({
  mockAgentFetch: vi.fn(),
  mockEnv: { DocumentAgent: {} } as Record<string, unknown>,
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockAgentFetch }),
}));

import { getAgentByName } from "agents";
import { handlePublicUpdate } from "~/lib/update.server";

function publicRequest(idParam: string, body: string) {
  return new Request(`https://mist.example.com/docs/${idParam}/public`, {
    method: "POST",
    body,
  });
}

describe("POST /docs/:id/public", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, public: true }), { status: 200 }),
    );
    delete mockEnv.MIST_API_TOKENS;
  });

  it("sets the flag on the aliased document", async () => {
    const res = await handlePublicUpdate(
      publicRequest("my-title-abcd1234.md", JSON.stringify({ public: true })),
      mockEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, public: true });

    expect(vi.mocked(getAgentByName).mock.calls.at(-1)![1]).toBe("abcd1234");
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(new URL(agentRequest.url).pathname).toBe("/public");
    expect(await agentRequest.json()).toEqual({ public: true });
  });

  it("returns 401 when tokens are configured and none is given", async () => {
    mockEnv.MIST_API_TOKENS = '{"s3cret":"alice@vio.com"}';
    const res = await handlePublicUpdate(
      publicRequest("abcd1234", JSON.stringify({ public: true })),
      mockEnv,
    );
    expect(res.status).toBe(401);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("returns 404 for an invalid id", async () => {
    const res = await handlePublicUpdate(
      publicRequest("!bad!", JSON.stringify({ public: true })),
      mockEnv,
    );
    expect(res.status).toBe(404);
  });
});
