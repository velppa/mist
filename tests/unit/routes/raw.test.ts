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

function call(id: string, query = "") {
  return loader({
    request: new Request(`https://mist.example.com/raw/${id}${query}`),
    params: { id },
    context,
  } as unknown as Parameters<typeof loader>[0]);
}

function mockDoc(fields: Record<string, unknown>) {
  mockAgentFetch.mockResolvedValue(
    new Response(JSON.stringify({ exists: true, ...fields })),
  );
}

describe("GET /raw/:id (always verbatim source)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc({ text: "# Heading\n\nbody", title: "Heading" });
  });

  it("serves markdown as text/markdown", async () => {
    const res = (await call("abcd1234")) as Response;
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe("# Heading\n\nbody");
  });

  it("serves txt as text/plain", async () => {
    mockDoc({ text: "plain text", format: "txt" });
    const res = (await call("abcd1234")) as Response;
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(await res.text()).toBe("plain text");
  });

  it("serves jsx as text/plain so the source displays in-browser", async () => {
    mockDoc({ text: "export default () => null", format: "jsx" });
    const res = (await call("abcd1234")) as Response;
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(await res.text()).toBe("export default () => null");
  });

  it("serves ipynb as application/json", async () => {
    const nb = JSON.stringify({ nbformat: 4, cells: [] });
    mockDoc({ text: nb, format: "ipynb" });
    const res = (await call("abcd1234")) as Response;
    expect(res.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(await res.text()).toBe(nb);
  });

  it("serves html verbatim as sandboxed text/html", async () => {
    mockDoc({ text: "<html>hi</html>", format: "html" });
    const res = (await call("abcd1234")) as Response;
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "sandbox allow-scripts",
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe("<html>hi</html>");
  });

  it("ignores the retired ?source=true param", async () => {
    const res = (await call("abcd1234", "?source=true")) as Response;
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(await res.text()).toBe("# Heading\n\nbody");
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

  it("resolves title-aliased params to the canonical id", async () => {
    const res = (await call("sapi-override-generator-abcd1234")) as Response;
    expect(res.status).toBe(200);
    const { getAgentByName } = await import("agents");
    const lastCall = vi.mocked(getAgentByName).mock.calls.at(-1)!;
    expect(lastCall[1]).toBe("abcd1234");
  });

  it("404s for an invalid id", async () => {
    await expect(call("abcd1234.pdf")).rejects.toMatchObject({ status: 404 });
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });
});
