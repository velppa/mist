import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const { mockAgentFetch, mockEnv } = vi.hoisted(() => ({
  mockAgentFetch: vi.fn(),
  // Mutable env — tests set auth vars on it and must clean them up
  mockEnv: { DocumentAgent: {} } as Record<string, unknown>,
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockAgentFetch }),
}));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockImplementation(() => ({ env: mockEnv })),
}));

vi.mock("~/shared/constants", async () => {
  const actual = await vi.importActual<typeof import("~/shared/constants")>(
    "~/shared/constants",
  );
  return {
    ...actual,
    generateDocumentId: vi.fn().mockReturnValue("abcd1234"),
  };
});

// Minimal mock — redirect just needs to return a Response with Location
vi.mock("react-router", () => ({
  redirect: (url: string) =>
    new Response(null, { status: 302, headers: { Location: url } }),
}));

import { action, loader } from "~/routes/new";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function postRequest(body: string | null, headers?: Record<string, string>) {
  const init: RequestInit = { method: "POST" };
  if (body !== null) init.body = body;
  if (headers) init.headers = headers;
  return new Request("https://mist.example.com/new", init);
}

function putRequest(body: string) {
  return new Request("https://mist.example.com/new", { method: "PUT", body });
}

// The action's second argument — context is passed to getCloudflare which is mocked
const context = {} as Parameters<typeof action>[0]["context"];

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("GET /new (loader)", () => {
  it("redirects to /", () => {
    const response = loader() as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
  });
});

describe("POST /new (action)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  });

  it("returns 201 with document URL for valid markdown", async () => {
    const request = postRequest("# Hello world\n\nSome content.");
    const response = await action({ request, context } as Parameters<typeof action>[0]);

    expect(response.status).toBe(201);
    expect(response.headers.get("Content-Type")).toBe("text/plain");

    const text = await response.text();
    expect(text).toBe("https://mist.example.com/docs/abcd1234\n");
  });

  it("returns 201 for empty body (blank document)", async () => {
    const request = postRequest("");
    const response = await action({ request, context } as Parameters<typeof action>[0]);

    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).toContain("/docs/abcd1234");
  });

  it("creates document via agent with content", async () => {
    const request = postRequest("# Test");
    await action({ request, context } as Parameters<typeof action>[0]);

    expect(mockAgentFetch).toHaveBeenCalledOnce();
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.method).toBe("POST");

    const body = await agentRequest.json();
    expect(body.content).toBe("# Test");
  });

  it("handles PUT requests (curl -T)", async () => {
    const md = "# Uploaded\n\nBody text.\n";
    const request = putRequest(md);
    const response = await action({ request, context } as Parameters<typeof action>[0]);

    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).toContain("/docs/abcd1234");

    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    const body = await agentRequest.json();
    expect(body.content).toBe("# Uploaded\n\nBody text.\n");
  });

  it("preserves newlines in multiline markdown", async () => {
    const md = "# Title\n\nParagraph one.\n\nParagraph two.\n";
    const request = postRequest(md);
    await action({ request, context } as Parameters<typeof action>[0]);

    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    const body = await agentRequest.json();
    expect(body.content).toBe("# Title\n\nParagraph one.\n\nParagraph two.\n");
  });

  it("sends empty POST to agent when body is blank", async () => {
    const request = postRequest("   ");
    await action({ request, context } as Parameters<typeof action>[0]);

    expect(mockAgentFetch).toHaveBeenCalledOnce();
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.headers.get("Content-Type")).toBeNull();
  });

  it("strips frontmatter and passes threads to agent", async () => {
    const md = `---
mist:
  threads:
    - comment: "Nice"
      author: "Alice"
      color: "#E57373"
      created: "2026-01-01T00:00:00Z"
      resolved: false
---

# Doc with threads
`;
    const request = postRequest(md);
    await action({ request, context } as Parameters<typeof action>[0]);

    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    const body = await agentRequest.json();
    expect(body.content).toBe("# Doc with threads\n");
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].commentText).toBe("Nice");
  });

  it("returns 400 for binary content (null bytes)", async () => {
    const request = postRequest("hello\0world");
    const response = await action({ request, context } as Parameters<typeof action>[0]);

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("binary");
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("returns 413 when content exceeds 1MB", async () => {
    const bigContent = "x".repeat(1_000_001);
    const request = postRequest(bigContent);
    const response = await action({ request, context } as Parameters<typeof action>[0]);

    expect(response.status).toBe(413);
    const text = await response.text();
    expect(text).toContain("too large");
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("returns 413 when content-length header exceeds 1MB", async () => {
    const request = postRequest("small body", {
      "content-length": "2000000",
    });
    const response = await action({ request, context } as Parameters<typeof action>[0]);

    expect(response.status).toBe(413);
    const text = await response.text();
    expect(text).toContain("too large");
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("relays agent error message on 400 response", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: "Unsupported CriticMarkup: substitution" }),
        { status: 400 },
      ),
    );

    const request = postRequest("some content");
    const response = await action({ request, context } as Parameters<typeof action>[0]);

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("Unsupported CriticMarkup");
  });

  it("returns generic error when agent fails with non-JSON response", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const request = postRequest("some content");
    const response = await action({ request, context } as Parameters<typeof action>[0]);

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("failed to create document");
  });

  it("returns 500 on unexpected error", async () => {
    mockAgentFetch.mockRejectedValue(new Error("network failure"));

    const request = postRequest("some content");
    const response = await action({ request, context } as Parameters<typeof action>[0]);

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("something went wrong");
  });

  it("all error responses are plain text", async () => {
    // Binary
    const r1 = await action({
      request: postRequest("a\0b"),
      context,
    } as Parameters<typeof action>[0]);
    expect(r1.headers.get("Content-Type")).toBe("text/plain");

    // Too large
    const r2 = await action({
      request: postRequest("x".repeat(1_000_001)),
      context,
    } as Parameters<typeof action>[0]);
    expect(r2.headers.get("Content-Type")).toBe("text/plain");
  });
});

/* ------------------------------------------------------------------ */
/*  Authentication                                                     */
/* ------------------------------------------------------------------ */

describe("POST /new authentication", () => {
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

  it("stays open when no auth is configured", async () => {
    const response = await action({
      request: postRequest("# Open"),
      context,
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(201);
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.headers.get("x-mist-author")).toBeNull();
  });

  it("uses the frontmatter author when the submitter is anonymous", async () => {
    const response = await action({
      request: postRequest("---\nauthor: fm-alice\n---\n# Doc"),
      context,
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(201);
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.headers.get("x-mist-author")).toBe("fm-alice");
  });

  it("prefers the verified email over a frontmatter author claim", async () => {
    mockEnv.MIST_API_TOKENS = '{"s3cret":"alice@vio.com"}';

    const response = await action({
      request: postRequest("---\nauthor: fm-bob\n---\n# Doc", {
        Authorization: "Bearer s3cret",
      }),
      context,
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(201);
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.headers.get("x-mist-author")).toBe("alice@vio.com");
  });

  it("forwards frontmatter public: true as x-mist-public", async () => {
    const response = await action({
      request: postRequest("---\npublic: true\n---\n# Doc"),
      context,
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(201);
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.headers.get("x-mist-public")).toBe("true");
  });

  it("omits x-mist-public without a frontmatter opt-in", async () => {
    const response = await action({
      request: postRequest("# Doc"),
      context,
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(201);
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.headers.get("x-mist-public")).toBeNull();
  });

  it("returns 401 when tokens configured and no Authorization header", async () => {
    mockEnv.MIST_API_TOKENS = '{"s3cret":"alice@vio.com"}';

    const response = await action({
      request: postRequest("# Doc"),
      context,
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    const text = await response.text();
    expect(text).toContain("authentication required");
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong token", async () => {
    mockEnv.MIST_API_TOKENS = '{"s3cret":"alice@vio.com"}';

    const response = await action({
      request: postRequest("# Doc", { Authorization: "Bearer nope" }),
      context,
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).toContain("invalid API token");
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("returns 201 and records author for a valid token", async () => {
    mockEnv.MIST_API_TOKENS = '{"s3cret":"alice@vio.com"}';

    const response = await action({
      request: postRequest("# Doc", { Authorization: "Bearer s3cret" }),
      context,
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(201);
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.headers.get("x-mist-author")).toBe("alice@vio.com");
  });

  it("accepts token:email CSV format", async () => {
    mockEnv.MIST_API_TOKENS = "tok1:alice@vio.com,tok2:bob@vio.com";

    const response = await action({
      request: postRequest("# Doc", { Authorization: "Bearer tok2" }),
      context,
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(201);
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.headers.get("x-mist-author")).toBe("bob@vio.com");
  });

  it("accepts a browser session when SSO is configured", async () => {
    mockEnv.ONELOGIN_SUBDOMAIN = "vio";
    mockEnv.ONELOGIN_CLIENT_ID = "client";
    mockEnv.ONELOGIN_CLIENT_SECRET = "secret";
    mockEnv.SESSION_SECRET = "session-secret";

    const { createSessionCookie } = await import("~/lib/auth.server");
    const setCookie = await createSessionCookie("carol@vio.com", "session-secret");
    const cookieValue = setCookie.split(";")[0]; // "mist_session=..."

    const response = await action({
      request: postRequest("# Doc", { Cookie: cookieValue }),
      context,
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(201);
    const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
    expect(agentRequest.headers.get("x-mist-author")).toBe("carol@vio.com");
  });

  it("returns 401 when SSO configured and no session nor token", async () => {
    mockEnv.ONELOGIN_SUBDOMAIN = "vio";
    mockEnv.ONELOGIN_CLIENT_ID = "client";
    mockEnv.ONELOGIN_CLIENT_SECRET = "secret";
    mockEnv.SESSION_SECRET = "session-secret";

    const response = await action({
      request: postRequest("# Doc"),
      context,
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(401);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });
});
