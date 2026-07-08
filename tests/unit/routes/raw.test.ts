import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAgentFetch, mockEnv } = vi.hoisted(() => ({
  mockAgentFetch: vi.fn(),
  mockEnv: { DocumentAgent: {} } as Record<string, unknown>,
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockAgentFetch }),
}));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockImplementation(() => ({ env: mockEnv })),
}));

vi.mock("react-router", () => ({
  data: (body: unknown, init?: ResponseInit) => {
    throw new Response(null, init);
  },
}));

import { loader } from "~/routes/raw.$id";

const context = {} as Parameters<typeof loader>[0]["context"];

function call(id: string) {
  return loader({
    request: new Request(`https://mist.example.com/raw/${id}`),
    params: { id },
    context,
  } as unknown as Parameters<typeof loader>[0]);
}

describe("GET /raw/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ exists: true, text: "the content" })),
    );
  });

  it("serves markdown with text/markdown and nosniff", async () => {
    const res = (await call("abcd1234")) as Response;
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(await res.text()).toBe("the content");
  });

  it("serves txt notes as text/plain", async () => {
    const res = (await call("abcd1234.txt")) as Response;
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });

  it("serves html notes as text/html with a sandbox CSP", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ exists: true, text: "<html>hi</html>" })),
    );
    const res = (await call("abcd1234.html")) as Response;
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "sandbox allow-scripts",
    );
    expect(await res.text()).toBe("<html>hi</html>");
  });

  it("requests the document text from the agent", async () => {
    await call("abcd1234");
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(new URL(agentRequest.url).searchParams.get("include")).toBe("text");
  });

  it("404s for a missing document", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ exists: false })),
    );
    await expect(call("abcd1234")).rejects.toMatchObject({ status: 404 });
  });

  it("404s for an invalid id", async () => {
    await expect(call("abcd1234.pdf")).rejects.toMatchObject({ status: 404 });
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });
});
