import { redirect } from "react-router";
import { getAgentByName } from "agents";
import type { Route } from "./+types/new";
import { generateDocumentId, type DocFormat } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { deserializeThreads } from "~/lib/thread-serialization";
import { extractDocMeta } from "~/lib/doc-meta";
import { authenticateNewRequest, type AuthEnv } from "~/lib/auth.server";
import { readUploadBody, textError } from "~/lib/upload.server";

export function loader() {
  return redirect("/");
}

/** Explicit ?format wins; otherwise sniff notebooks (JSON with nbformat
and cells), then html; default md. Returns null for an unrecognized
format value. jsx is never sniffed. */
function resolveFormat(request: Request, content: string): DocFormat | null {
  const param = new URL(request.url).searchParams.get("format");
  if (
    param === "txt" ||
    param === "html" ||
    param === "md" ||
    param === "jsx" ||
    param === "ipynb"
  )
    return param;
  if (param !== null) return null;
  if (content.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (parsed && "nbformat" in parsed && "cells" in parsed) return "ipynb";
    } catch {
      // Not JSON — fall through to the other sniffs
    }
  }
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

    const content = await readUploadBody(request);
    if (content instanceof Response) {
      return content;
    }

    const format = resolveFormat(request, content);
    if (format === null) {
      return textError("unknown format (use md, txt, html, jsx or ipynb)", 400);
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
