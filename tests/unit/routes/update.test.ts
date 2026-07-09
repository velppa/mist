// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAgentFetch, mockEnv } = vi.hoisted(() => ({
  mockAgentFetch: vi.fn(),
  mockEnv: { DocumentAgent: {} } as Record<string, unknown>,
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockAgentFetch }),
}));

import { handleDocUpdate } from "~/lib/update.server";

function putRequest(id: string, body: string, headers?: Record<string, string>) {
  return new Request(`https://mist.example.com/docs/${id}`, {
    method: "PUT",
    body,
    headers,
  });
}

function call(request: Request, _id?: string) {
  return handleDocUpdate(request, mockEnv);
}

describe("PUT /docs/:id (action)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    delete mockEnv.MIST_API_TOKENS;
    delete mockEnv.ONELOGIN_SUBDOMAIN;
    delete mockEnv.ONELOGIN_CLIENT_ID;
    delete mockEnv.ONELOGIN_CLIENT_SECRET;
    delete mockEnv.SESSION_SECRET;
  });

  it("replaces content and returns the doc URL", async () => {
    const res = (await call(putRequest("abcd1234", "# New"), "abcd1234")) as Response;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("https://mist.example.com/docs/abcd1234\n");

    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.method).toBe("PUT");
    const body = (await agentRequest.json()) as { content: string };
    expect(body.content).toBe("# New");
  });

  it("returns 401 when tokens are configured and none is given", async () => {
    mockEnv.MIST_API_TOKENS = '{"s3cret":"alice@vio.com"}';
    const res = (await call(putRequest("abcd1234", "x"), "abcd1234")) as Response;
    expect(res.status).toBe(401);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("accepts a title-aliased path and updates the canonical doc", async () => {
    const res = (await call(
      putRequest("my-title-abcd1234", "# New"),
    )) as Response;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("https://mist.example.com/docs/abcd1234\n");
    const { getAgentByName } = await import("agents");
    const lastCall = vi.mocked(getAgentByName).mock.calls.at(-1)!;
    expect(lastCall[1]).toBe("abcd1234");
  });

  it("returns 404 for an invalid id", async () => {
    const res = await call(putRequest("!bad-id!", "x"));
    expect(res.status).toBe(404);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("relays a 409 review conflict from the document", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: "cannot update: 2 unresolved comments" }),
        { status: 409 },
      ),
    );
    const res = (await call(putRequest("abcd1234", "x"), "abcd1234")) as Response;
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("2 unresolved comments");
  });

  it("relays 404 for a document that does not exist", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "document not found" }), {
        status: 404,
      }),
    );
    const res = (await call(putRequest("zzzz9999", "x"), "zzzz9999")) as Response;
    expect(res.status).toBe(404);
  });

  it("strips markdown frontmatter threads like creation does", async () => {
    const md = "---\nmist:\n  threads: []\n---\n\n# Doc\n";
    const res = (await call(putRequest("abcd1234", md), "abcd1234")) as Response;
    expect(res.status).toBe(200);
    const body = (await (mockAgentFetch.mock.calls[0][0] as Request).json()) as {
      content: string;
    };
    expect(body.content).toBe("# Doc\n");
  });

  it("sends non-markdown formats verbatim", async () => {
    const html = "<!doctype html><title>t</title>";
    const res = (await call(putRequest("abcd1234.html", html), "abcd1234.html")) as Response;
    expect(res.status).toBe(200);
    const body = (await (mockAgentFetch.mock.calls[0][0] as Request).json()) as {
      content: string;
      threads?: unknown;
    };
    expect(body.content).toBe(html);
    expect(body.threads).toBeUndefined();
  });

  it("rejects binary bodies", async () => {
    const res = (await call(putRequest("abcd1234", "bad\0bytes"), "abcd1234")) as Response;
    expect(res.status).toBe(400);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("handles url-encoded ids safely", async () => {
    const req = new Request("https://mist.example.com/docs/abcd1234%2Fetc", {
      method: "PUT",
      body: "x",
    });
    const res = await call(req);
    expect(res.status).toBe(404);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });
});
