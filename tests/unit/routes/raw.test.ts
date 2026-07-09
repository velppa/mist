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

describe("GET /raw/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ exists: true, text: "# Heading\n\nbody", title: "Heading" }),
      ),
    );
  });

  describe("rendered (default)", () => {
    it("renders markdown to a sandboxed html page", async () => {
      const res = (await call("abcd1234")) as Response;
      expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("Content-Security-Policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      const body = await res.text();
      expect(body).toContain("<h1>Heading</h1>");
      expect(body).toContain("<title>Heading</title>");
    });

    it("serves txt notes as text/plain (rendered == source)", async () => {
      const res = (await call("abcd1234.txt")) as Response;
      expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("Content-Security-Policy")).toBeNull();
      expect(await res.text()).toBe("# Heading\n\nbody");
    });

    it("serves jsx notes as the sandboxed runner page", async () => {
      mockAgentFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ exists: true, text: "export default () => null" }),
        ),
      );
      const res = (await call("abcd1234.jsx")) as Response;
      expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("Content-Security-Policy")).toBe(
        "sandbox allow-scripts",
      );
      const body = await res.text();
      expect(body).toContain("unpkg.com/react@18");
      expect(body).toContain("babel.min.js");
      expect(body).toContain(JSON.stringify("export default () => null"));
    });

    it("serves html notes verbatim as sandboxed text/html", async () => {
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
  });

  describe("?source=true", () => {
    it("serves markdown source as text/markdown without CSP", async () => {
      const res = (await call("abcd1234", "?source=true")) as Response;
      expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
      expect(res.headers.get("Content-Security-Policy")).toBeNull();
      expect(await res.text()).toBe("# Heading\n\nbody");
    });

    it("serves jsx source as text/plain", async () => {
      const res = (await call("abcd1234.jsx", "?source=true")) as Response;
      expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("Content-Security-Policy")).toBeNull();
      expect(await res.text()).toBe("# Heading\n\nbody");
    });

    it("serves html source as text/plain so the markup displays", async () => {
      mockAgentFetch.mockResolvedValue(
        new Response(JSON.stringify({ exists: true, text: "<html>hi</html>" })),
      );
      const res = (await call("abcd1234.html", "?source=true")) as Response;
      expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("Content-Security-Policy")).toBeNull();
      expect(await res.text()).toBe("<html>hi</html>");
    });

    it("serves txt source as text/plain", async () => {
      const res = (await call("abcd1234.txt", "?source=true")) as Response;
      expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    });
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
