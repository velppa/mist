import { redirect } from "react-router";
import { getAgentByName } from "agents";
import type { Route } from "./+types/new";
import { generateDocumentId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { deserializeThreads } from "~/lib/thread-serialization";
import { extractDocMeta } from "~/lib/doc-meta";
import { authenticateNewRequest, type AuthEnv } from "~/lib/auth.server";

const MAX_CONTENT_BYTES = 1_000_000; // 1 MB

function textError(message: string, status: number) {
  return new Response(`error: ${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

export function loader() {
  return redirect("/");
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
      return textError("content too large (max 1MB)", 413);
    }

    const content = await request.text();

    if (content.length > MAX_CONTENT_BYTES) {
      return textError("content too large (max 1MB)", 413);
    }

    if (content.includes("\0")) {
      return textError("file appears to be binary, not text", 400);
    }

    const id = generateDocumentId();
    const stub = await getAgentByName(env.DocumentAgent, id);

    const headers = new Headers();
    // Frontmatter is stripped before the content reaches the document, so
    // frontmatter claims must be forwarded here; a verified email wins.
    const meta = extractDocMeta(content);
    const author = auth.email ?? meta.author;
    if (author) {
      headers.set("x-mist-author", author);
    }
    if (meta.isPublic) {
      headers.set("x-mist-public", "true");
    }

    const init: RequestInit = { method: "POST", headers };

    if (content.trim()) {
      const { body, threads } = deserializeThreads(content);
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify({ content: body, threads });
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
