/**
 * /mcp — Model Context Protocol endpoint for AI agents.
 *
 * Each tool is a thin wrapper over the HTTP API the mist-publisher skill
 * documents, called with the caller's own credentials, so permissions,
 * authorship and the review guards are exactly those of the API.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { getAgentByName } from "agents";
import { z } from "zod";
import { APP_VERSION, parseDocId } from "~/shared/constants";
import {
  externalUrl,
  getBearerEmail,
  getBearerToken,
  isAuthConfigured,
  isSsoConfigured,
  type AuthEnv,
} from "~/lib/auth.server";
import { handleNewDocument } from "~/lib/new.server";
import { handleDocUpdate } from "~/lib/update.server";
import { handleAssetUpload } from "~/lib/assets.server";
import { handleThreadsRequest } from "~/lib/threads.server";
import { MCP_PATH, protectedResourceMetadataUrl } from "~/lib/mcp-oauth.server";

interface McpEnv extends AuthEnv {
  DocumentAgent: Parameters<typeof getAgentByName>[0];
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** A document reference: bare id, title alias, or a full mist URL. */
export function docIdFrom(ref: string): string | null {
  const path = ref.trim().split(/[?#]/)[0].replace(/\/+$/, "");
  return parseDocId(decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)));
}

/** The API's error message, whether it answered in plain text or JSON. */
async function errorText(res: Response): Promise<string> {
  const text = (await res.text()).trim();
  try {
    const { error } = JSON.parse(text) as { error?: unknown };
    if (typeof error === "string" && error) return error;
  } catch {
    // plain-text error
  }
  return text.replace(/^error:\s*/, "") || `request failed (${res.status})`;
}

const FORMATS = ["md", "txt", "html", "jsx", "ipynb"] as const;

export function buildServer(request: Request, env: McpEnv): McpServer {
  const origin = externalUrl(request).origin;
  const auth = request.headers.get("Authorization");

  /** A request to the HTTP API carrying the caller's credentials. */
  function api(path: string, init: RequestInit = {}): Request {
    const headers = new Headers(init.headers);
    if (auth) headers.set("Authorization", auth);
    return new Request(`${origin}${path}`, { ...init, headers });
  }

  const server = new McpServer({ name: "mist", version: APP_VERSION });

  server.registerTool(
    "read",
    {
      description:
        "Read a document's current source, verbatim. Always read before update: " +
        "the user may have edited the document in the mist editor.",
      inputSchema: { id: z.string().describe("Document id, title alias, or mist URL") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const docId = docIdFrom(id);
      if (!docId) return fail("document not found");
      const stub = await getAgentByName(env.DocumentAgent, docId);
      const res = await stub.fetch(new Request("https://do/?include=text"));
      const { exists, text } = (await res.json()) as { exists: boolean; text?: string };
      return exists ? ok(text ?? "") : fail("document not found");
    },
  );

  server.registerTool(
    "publish",
    {
      description:
        "Publish a new document and return its id and URL. New documents are " +
        "unlisted and private. Upload large binary blobs with post_asset and " +
        "reference them instead of inlining them.",
      inputSchema: {
        body: z.string().describe("Document source, stored verbatim"),
        format: z
          .enum(FORMATS)
          .optional()
          .describe("md (default), txt, html, jsx or ipynb; sniffed when omitted"),
      },
    },
    async ({ body, format }) => {
      const res = await handleNewDocument(
        api(`/new${format ? `?format=${format}` : ""}`, { method: "POST", body }),
        env,
      );
      if (!res.ok) return fail(await errorText(res));
      const url = (await res.text()).trim();
      return ok(JSON.stringify({ id: docIdFrom(url), url }));
    },
  );

  server.registerTool(
    "update",
    {
      description:
        "Replace a document's whole body. Read it first and apply changes on " +
        "top of the current version. Fails while the document has unresolved " +
        "comments (resolve them via threads/resolve) or pending suggestions " +
        "(the user's call, never work around it).",
      inputSchema: {
        id: z.string().describe("Document id, title alias, or mist URL"),
        body: z.string().describe("New document source, stored verbatim"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id, body }) => {
      const docId = docIdFrom(id);
      if (!docId) return fail("document not found");
      const res = await handleDocUpdate(api(`/docs/${docId}`, { method: "PUT", body }), env);
      if (!res.ok) return fail(await errorText(res));
      return ok((await res.text()).trim());
    },
  );

  server.registerTool(
    "post_asset",
    {
      description:
        "Upload an image, JSON dataset, script, stylesheet or font and return " +
        "its URL. Reference it in documents by the relative path " +
        "(![alt](/assets/...) in markdown, fetch(\"/assets/...\") in html/jsx). " +
        "Assets are public by unguessable URL. Max 20 MB.",
      inputSchema: {
        body_base64: z.string().describe("File content, base64-encoded"),
        content_type: z
          .string()
          .describe("MIME type, e.g. image/png, image/svg+xml, application/json, text/css"),
        name: z.string().optional().describe("Label used in the asset's file name"),
      },
    },
    async ({ body_base64, content_type, name }) => {
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = Uint8Array.from(atob(body_base64.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
      } catch {
        return fail("body_base64 is not valid base64");
      }
      const query = name ? `?name=${encodeURIComponent(name)}` : "";
      const res = await handleAssetUpload(
        api(`/assets${query}`, {
          method: "POST",
          headers: { "Content-Type": content_type },
          body: bytes,
        }),
        env,
      );
      if (!res.ok) return fail(await errorText(res));
      const path = (await res.text()).trim();
      return ok(JSON.stringify({ path, url: `${origin}${path}` }));
    },
  );

  server.registerTool(
    "threads",
    {
      description:
        "List a document's comment threads, oldest first. Comments are review " +
        "feedback addressed to you; unresolved ones block update.",
      inputSchema: { id: z.string().describe("Document id, title alias, or mist URL") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const docId = docIdFrom(id);
      if (!docId) return fail("document not found");
      const res = await handleThreadsRequest(api(`/docs/${docId}/threads`), env);
      if (!res.ok) return fail(await errorText(res));
      const { threads } = (await res.json()) as { threads: unknown[] };
      return ok(JSON.stringify(threads));
    },
  );

  server.registerTool(
    "reply",
    {
      description:
        "Reply to a comment thread, e.g. to say what you changed or why you " +
        "did not, or to ask the user for a decision. The reply is signed " +
        "with your identity.",
      inputSchema: {
        id: z.string().describe("Document id, title alias, or mist URL"),
        thread_id: z.string().describe("Thread id from the threads tool"),
        text: z.string().describe("Reply text"),
      },
    },
    async ({ id, thread_id, text }) => {
      const docId = docIdFrom(id);
      if (!docId) return fail("document not found");
      const res = await handleThreadsRequest(
        api(`/docs/${docId}/threads/${encodeURIComponent(thread_id)}/replies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }),
        env,
      );
      if (!res.ok) return fail(await errorText(res));
      return ok(await res.text());
    },
  );

  server.registerTool(
    "resolve",
    {
      description:
        "Resolve a comment thread once the feedback has been acted on and " +
        "answered with reply. " +
        "Resolve only after the comment is answered, never just to clear the " +
        "update guard; leave threads asking for the user's decision open.",
      inputSchema: {
        id: z.string().describe("Document id, title alias, or mist URL"),
        thread_id: z.string().describe("Thread id from the threads tool"),
      },
    },
    async ({ id, thread_id }) => {
      const docId = docIdFrom(id);
      if (!docId) return fail("document not found");
      const res = await handleThreadsRequest(
        api(`/docs/${docId}/threads/${encodeURIComponent(thread_id)}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolved: true }),
        }),
        env,
      );
      if (!res.ok) return fail(await errorText(res));
      return ok(await res.text());
    },
  );

  return server;
}

/**
 * Serve an MCP request. Callers authenticate with a bearer token — a
 * mist API token, or one obtained through the OAuth flow.
 */
export async function handleMcpRequest(
  request: Request,
  env: unknown,
  ctx: ExecutionContext,
): Promise<Response> {
  const mcpEnv = env as McpEnv;

  if (request.method !== "OPTIONS" && isAuthConfigured(mcpEnv)) {
    const email = getBearerToken(request) !== null ? await getBearerEmail(request, mcpEnv) : null;
    if (!email) {
      const challenge = isSsoConfigured(mcpEnv)
        ? `Bearer resource_metadata="${protectedResourceMetadataUrl(request)}"`
        : "Bearer";
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": challenge,
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "WWW-Authenticate",
        },
      });
    }
  }

  const handler = createMcpHandler(buildServer(request, mcpEnv), { route: MCP_PATH });
  return handler(request, env, ctx);
}
