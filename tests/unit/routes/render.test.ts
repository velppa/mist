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

import { loader } from "~/routes/render.$id";
import { requiresLogin } from "~/lib/auth.server";

const context = {} as Parameters<typeof loader>[0]["context"];

function call(id: string) {
  return loader({
    request: new Request(`https://mist.example.com/render/${id}`),
    params: { id },
    context,
  } as unknown as Parameters<typeof loader>[0]);
}

function mockDoc(fields: Record<string, unknown>) {
  mockAgentFetch.mockResolvedValue(
    new Response(JSON.stringify({ exists: true, ...fields })),
  );
}

function expectRenderedHeaders(res: Response) {
  expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(res.headers.get("Content-Security-Policy")).toBe(
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
  );
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
}

describe("GET /render/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc({ text: "# Heading\n\nbody", title: "Heading" });
  });

  it("renders markdown to a styled page", async () => {
    mockDoc({
      text: "---\nauthor: alice\n---\n# Heading\n\nbody",
      title: "Heading",
    });
    const res = (await call("abcd1234")) as Response;
    expectRenderedHeaders(res);
    const body = await res.text();
    expect(body).toContain("<h1>Heading</h1>");
    expect(body).toContain("<title>Heading</title>");
    expect(body).toContain('class="frontmatter"');
    expect(body).toContain("author: alice");
  });

  it("renders jsx via the runner page", async () => {
    mockDoc({ text: "export default () => null", format: "jsx" });
    const res = (await call("abcd1234")) as Response;
    expectRenderedHeaders(res);
    const body = await res.text();
    expect(body).toContain("unpkg.com/react@18");
    expect(body).toContain(JSON.stringify("export default () => null"));
  });

  it("renders ipynb via the notebook page", async () => {
    const nb = JSON.stringify({ nbformat: 4, cells: [] });
    mockDoc({ text: nb, format: "ipynb" });
    const res = (await call("abcd1234")) as Response;
    expectRenderedHeaders(res);
    expect(await res.text()).toContain("marked.umd.js");
  });

  it("serves html documents verbatim", async () => {
    mockDoc({ text: "<html>hi</html>", format: "html" });
    const res = (await call("abcd1234")) as Response;
    expectRenderedHeaders(res);
    expect(await res.text()).toBe("<html>hi</html>");
  });

  it("renders txt in an escaped pre block", async () => {
    mockDoc({ text: "a <b> & c", format: "txt", title: "Notes" });
    const res = (await call("abcd1234")) as Response;
    expectRenderedHeaders(res);
    const body = await res.text();
    expect(body).toContain("<pre");
    expect(body).toContain("a &lt;b&gt; &amp; c");
    expect(body).not.toContain("a <b> & c");
  });

  it("404s for a missing document", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ exists: false })),
    );
    await expect(call("abcd1234")).rejects.toMatchObject({ status: 404 });
  });

  it("404s for an invalid id", async () => {
    await expect(call("nope.pdf")).rejects.toMatchObject({ status: 404 });
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("is SSO-gated like other pages", () => {
    expect(requiresLogin("/render/abcd1234")).toBe(true);
  });
});
