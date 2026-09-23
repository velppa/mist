/**
 * MCP tools, driven through a real MCP client over an in-memory link.
 * Documents and assets live in small fakes of their Durable Objects;
 * everything between the tool and the fake is the production code path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

interface FakeDoc {
  text: string;
  format: string;
  author: string | null;
  threads: Array<{
    id: string;
    resolved: boolean;
    commentText: string;
    replies?: Array<{ text: string; author: string }>;
  }>;
}

const { docs, assets, env } = vi.hoisted(() => ({
  docs: new Map<string, FakeDoc>(),
  assets: [] as Array<{ name: string; type: string; author: string | null; size: number }>,
  env: {
    DocumentAgent: { kind: "doc" },
    AssetStore: { kind: "assets" },
    MIST_API_TOKENS: '{"s3cret":"alice@vio.com"}',
  } as Record<string, unknown>,
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function docFetch(id: string, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const doc = docs.get(id);
  if (url.pathname === "/" && req.method === "GET") {
    return json(doc ? { exists: true, text: doc.text } : { exists: false });
  }
  if (url.pathname === "/" && req.method === "POST") {
    const body = req.headers.get("Content-Type") ? ((await req.json()) as { content: string }) : { content: "" };
    docs.set(id, {
      text: body.content,
      format: req.headers.get("x-mist-format") ?? "md",
      author: req.headers.get("x-mist-author"),
      threads: [],
    });
    return json({ ok: true }, 201);
  }
  if (!doc) return json({ ok: false, error: "document not found" }, 404);
  if (url.pathname === "/" && req.method === "PUT") {
    const open = doc.threads.filter((t) => !t.resolved).length;
    if (open) return json({ ok: false, error: `cannot update: ${open} unresolved comment` }, 409);
    doc.text = ((await req.json()) as { content: string }).content;
    return json({ ok: true });
  }
  if (url.pathname === "/threads") return json({ ok: true, threads: doc.threads });
  const reply = url.pathname.match(/^\/threads\/([^/]+)\/replies$/);
  if (reply) {
    const thread = doc.threads.find((t) => t.id === reply[1]);
    if (!thread) return json({ ok: false, error: "thread not found" }, 404);
    const { text } = (await req.json()) as { text?: string };
    if (!text?.trim()) return json({ ok: false, error: 'body must be {"text": "..."}' }, 400);
    const entry = { text, author: req.headers.get("x-mist-author") ?? "agent" };
    thread.replies = [...(thread.replies ?? []), entry];
    return json({ ok: true, reply: entry });
  }
  const resolve = url.pathname.match(/^\/threads\/([^/]+)\/resolve$/);
  if (resolve) {
    const thread = doc.threads.find((t) => t.id === resolve[1]);
    if (!thread) return json({ ok: false, error: "thread not found" }, 404);
    thread.resolved = ((await req.json()) as { resolved: boolean }).resolved;
    return json({ ok: true, resolved: thread.resolved });
  }
  return json({ ok: false }, 404);
}

vi.mock("agents", () => ({
  getAgentByName: vi.fn(async (ns: { kind: string }, name: string) => ({
    fetch: async (req: Request) => {
      if (ns.kind === "assets") {
        const url = new URL(req.url);
        const size = (await req.arrayBuffer()).byteLength;
        assets.push({
          name: url.searchParams.get("name")!,
          type: url.searchParams.get("type")!,
          author: url.searchParams.get("author"),
          size,
        });
        return new Response(null, { status: 201 });
      }
      return docFetch(name, req);
    },
  })),
}));

// The Workers-only transport cannot load here; tools are reached through
// the SDK client instead.
vi.mock("agents/mcp", () => ({
  createMcpHandler: () => async () => new Response("mcp"),
}));

vi.mock("~/shared/constants", async () => {
  const actual = await vi.importActual<typeof import("~/shared/constants")>("~/shared/constants");
  return { ...actual, generateDocumentId: vi.fn().mockReturnValue("abcd1234") };
});

import { buildServer, docIdFrom, handleMcpRequest } from "~/lib/mcp.server";

const ctx = {} as ExecutionContext;

async function connect(authorization = "Bearer s3cret") {
  const request = new Request("https://mist.example.com/mcp", {
    headers: { Authorization: authorization },
  });
  const server = buildServer(request, env as never);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return { text: result.content[0].text, isError: result.isError === true };
}

beforeEach(() => {
  docs.clear();
  assets.length = 0;
});

describe("MCP authentication", () => {
  it("challenges callers without a token", async () => {
    const res = await handleMcpRequest(
      new Request("https://mist.example.com/mcp", { method: "POST" }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("points OAuth-capable clients at the resource metadata when sign-in is configured", async () => {
    const ssoEnv = {
      ...env,
      ONELOGIN_SUBDOMAIN: "vio",
      ONELOGIN_CLIENT_ID: "c",
      ONELOGIN_CLIENT_SECRET: "s",
      SESSION_SECRET: "x",
    };
    const res = await handleMcpRequest(
      new Request("https://mist.example.com/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
      }),
      ssoEnv,
      ctx,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://mist.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("serves callers with a valid token", async () => {
    const res = await handleMcpRequest(
      new Request("https://mist.example.com/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer s3cret" },
      }),
      env,
      ctx,
    );
    expect(await res.text()).toBe("mcp");
  });
});

describe("MCP tools", () => {
  it("lists exactly the seven tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["post_asset", "publish", "read", "reply", "resolve", "threads", "update"],
    );
  });

  it("publishes as the token's owner and reads the body back verbatim", async () => {
    const client = await connect();
    const body = "---\nauthor: bob\n---\n# Hello\n";
    const published = await call(client, "publish", { body, format: "md" });
    expect(published.isError).toBe(false);
    expect(JSON.parse(published.text)).toEqual({
      id: "abcd1234",
      url: "https://mist.example.com/docs/abcd1234.md",
    });
    expect(docs.get("abcd1234")!.author).toBe("alice@vio.com");

    const read = await call(client, "read", { id: "https://mist.example.com/docs/hello-abcd1234.md" });
    expect(read.text).toBe(body);
  });

  it("sniffs the format when none is given", async () => {
    const client = await connect();
    await call(client, "publish", { body: "<!doctype html><p>hi</p>" });
    expect(docs.get("abcd1234")!.format).toBe("html");
  });

  it("updates a document and relays the unresolved-comment guard", async () => {
    docs.set("abcd1234", {
      text: "old",
      format: "md",
      author: null,
      threads: [{ id: "t1", resolved: false, commentText: "fix" }],
    });
    const client = await connect();

    const blocked = await call(client, "update", { id: "abcd1234", body: "new" });
    expect(blocked).toEqual({ isError: true, text: "cannot update: 1 unresolved comment" });
    expect(docs.get("abcd1234")!.text).toBe("old");

    const threads = await call(client, "threads", { id: "abcd1234" });
    expect(JSON.parse(threads.text)).toEqual([{ id: "t1", resolved: false, commentText: "fix" }]);

    expect(await call(client, "resolve", { id: "abcd1234", thread_id: "nope" })).toEqual({
      isError: true,
      text: "thread not found",
    });
    const resolved = await call(client, "resolve", { id: "abcd1234", thread_id: "t1" });
    expect(resolved.isError).toBe(false);

    const updated = await call(client, "update", { id: "abcd1234", body: "new" });
    expect(updated.isError).toBe(false);
    expect(docs.get("abcd1234")!.text).toBe("new");
  });

  it("replies to a thread as the token's owner", async () => {
    docs.set("abcd1234", {
      text: "x",
      format: "md",
      author: null,
      threads: [{ id: "t1", resolved: false, commentText: "why?" }],
    });
    const client = await connect();

    const replied = await call(client, "reply", { id: "abcd1234", thread_id: "t1", text: "Because." });
    expect(replied.isError).toBe(false);
    expect(docs.get("abcd1234")!.threads[0].replies).toEqual([
      { text: "Because.", author: "alice@vio.com" },
    ]);
    expect(docs.get("abcd1234")!.threads[0].resolved).toBe(false);

    expect(await call(client, "reply", { id: "abcd1234", thread_id: "t1", text: " " })).toEqual({
      isError: true,
      text: 'body must be {"text": "..."}',
    });
    expect(await call(client, "reply", { id: "abcd1234", thread_id: "nope", text: "hi" })).toEqual({
      isError: true,
      text: "thread not found",
    });
  });

  it("reports unknown documents as errors", async () => {
    const client = await connect();
    expect(await call(client, "read", { id: "abcd1234" })).toEqual({
      isError: true,
      text: "document not found",
    });
    expect((await call(client, "read", { id: "!bad!" })).isError).toBe(true);
    expect(await call(client, "resolve", { id: "abcd1234", thread_id: "t1" })).toEqual({
      isError: true,
      text: "document not found",
    });
  });

  it("uploads decoded asset bytes and returns path and URL", async () => {
    const client = await connect();
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47));
    const result = await call(client, "post_asset", {
      body_base64: png,
      content_type: "image/png",
      name: "chart",
    });
    expect(result.isError).toBe(false);
    const { path, url } = JSON.parse(result.text) as { path: string; url: string };
    expect(path).toMatch(/^\/assets\/.*chart.*\.png$/);
    expect(url).toBe(`https://mist.example.com${path}`);
    expect(assets).toEqual([
      expect.objectContaining({ type: "image/png", author: "alice@vio.com", size: 4 }),
    ]);
  });

  it("rejects unsupported asset types and malformed base64", async () => {
    const client = await connect();
    const zip = await call(client, "post_asset", { body_base64: "AAAA", content_type: "application/zip" });
    expect(zip.isError).toBe(true);
    expect(zip.text).toContain("unsupported content type");
    expect((await call(client, "post_asset", { body_base64: "@@@", content_type: "image/png" })).isError).toBe(true);
    expect(assets).toEqual([]);
  });

  it("refuses writes when the caller's token is not valid", async () => {
    const client = await connect("Bearer wrong");
    const result = await call(client, "publish", { body: "# Hi" });
    expect(result).toEqual({ isError: true, text: "invalid API token" });
    expect(docs.size).toBe(0);
  });
});

describe("docIdFrom", () => {
  it("accepts ids, aliases and URLs", () => {
    expect(docIdFrom("abcd1234")).toBe("abcd1234");
    expect(docIdFrom("my-title-abcd1234.md")).toBe("abcd1234");
    expect(docIdFrom("https://mist.example.com/docs/abcd1234.md?view=edit")).toBe("abcd1234");
    expect(docIdFrom("https://mist.example.com/raw/abcd1234/")).toBe("abcd1234");
    expect(docIdFrom("")).toBeNull();
  });
});
