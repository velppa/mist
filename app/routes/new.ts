import { redirect } from "react-router";
import { getAgentByName } from "agents";
import type { Route } from "./+types/new";
import { generateDocumentId, type DocFormat } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { deserializeThreads } from "~/lib/thread-serialization";
import { extractDocMeta } from "~/lib/doc-meta";
import { authenticateNewRequest, type AuthEnv } from "~/lib/auth.server";

// Cloudflare's proxy caps request bodies at 100 MB; the DO stores the Yjs
// state in chunks, so the practical ceiling is CPU, not storage. 20 MB keeps
// generous headroom for Yjs/JSON overhead.
const MAX_CONTENT_BYTES = 20_000_000; // 20 MB

function textError(message: string, status: number) {
  return new Response(`error: ${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

export function loader() {
  return redirect("/");
}

/** Explicit ?format=md|txt|html wins; otherwise sniff html; default md.
Returns null for an unrecognized format value. */
function resolveFormat(request: Request, content: string): DocFormat | null {
  const param = new URL(request.url).searchParams.get("format");
  if (param === "txt" || param === "html" || param === "md") return param;
  if (param !== null) return null;
  const head = content.trimStart().slice(0, 15).toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) return "html";
  return "md";
}

export async function action({ request, context }: Route.ActionArgs) {
  try {
    const { env } = getCloudflare(context);

    const auth = await authenticateNewRequest(request, env as AuthEnv);
    if (!auth.ok) {
      return textError(auth.message, 401);
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_CONTENT_BYTES) {
      return textError("content too large (max 20MB)", 413);
    }

    const content = await request.text();

    if (content.length > MAX_CONTENT_BYTES) {
      return textError("content too large (max 20MB)", 413);
    }

    if (content.includes("\0")) {
      return textError("file appears to be binary, not text", 400);
    }

    const format = resolveFormat(request, content);
    if (format === null) {
      return textError("unknown format (use md, txt or html)", 400);
    }
    const id =
      generateDocumentId() + (format === "md" ? "" : `.${format}`);
    const stub = await getAgentByName(env.DocumentAgent, id);

    const headers = new Headers();
    // Frontmatter (author/listed/threads) is a markdown concept; txt and
    // html bodies are stored verbatim. Frontmatter is stripped before the
    // content reaches the document, so claims are forwarded as headers;
    // a verified email wins over a frontmatter author.
    const meta = format === "md" ? extractDocMeta(content) : null;
    const author = auth.email ?? meta?.author;
    if (author) {
      headers.set("x-mist-author", author);
    }
    if (meta?.isListed) {
      headers.set("x-mist-listed", "true");
    }

    const init: RequestInit = { method: "POST", headers };

    if (content.trim()) {
      headers.set("Content-Type", "application/json");
      if (format === "md") {
        const { body, threads } = deserializeThreads(content);
        init.body = JSON.stringify({ content: body, threads });
      } else {
        init.body = JSON.stringify({ content });
      }
    }

    const res = await stub.fetch(new Request("https://do/", init));

    if (!res.ok) {
      try {
        const err = (await res.json()) as { error?: string };
        return textError(err.error ?? "failed to create document", res.status);
      } catch {
        return textError("failed to create document", res.status);
      }
    }

    const url = new URL(request.url);
    return new Response(`${url.origin}/docs/${id}\n`, {
      status: 201,
      headers: { "Content-Type": "text/plain" },
    });
  } catch {
    return textError("something went wrong", 500);
  }
}
