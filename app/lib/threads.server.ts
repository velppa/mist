import { getAgentByName } from "agents";
import { parseDocId } from "~/shared/constants";
import { authenticateNewRequest, type AuthEnv } from "~/lib/auth.server";
import { textError } from "~/lib/upload.server";

interface ThreadsEnv extends AuthEnv {
  DocumentAgent: Parameters<typeof getAgentByName>[0];
}

/**
 * Comment-thread API, the programmatic counterpart of the sidebar:
 *
 *   GET  /docs/:id/threads                      — list comment threads
 *   POST /docs/:id/threads/:threadId/replies    — {"text": "..."}
 *   POST /docs/:id/threads/:threadId/resolve    — {"resolved": true|false}, default true
 *
 * Authenticated like every write path (bearer token or session); the
 * verified identity is stamped as the reply author.
 */
export async function handleThreadsRequest(request: Request, env: unknown): Promise<Response> {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/docs\/([^/]+)\/threads(\/.*)?$/);
    const id = match ? parseDocId(decodeURIComponent(match[1])) : null;
    if (!id) {
      return textError("document not found", 404);
    }
    const subPath = match?.[2] ?? "";
    if (subPath && !/^\/[^/]+\/(replies|resolve)$/.test(subPath)) {
      return textError("not found", 404);
    }
    if (subPath ? request.method !== "POST" : request.method !== "GET") {
      return textError("method not allowed", 405);
    }

    const authEnv = env as ThreadsEnv;
    const auth = await authenticateNewRequest(request, authEnv);
    if (!auth.ok) {
      return textError(auth.message, 401);
    }

    const headers = new Headers({ "Content-Type": "application/json" });
    if (auth.email) headers.set("x-mist-author", auth.email);

    const stub = await getAgentByName(authEnv.DocumentAgent, id);
    const res = await stub.fetch(
      new Request(`https://do/threads${subPath}`, {
        method: request.method,
        headers,
        body: request.method === "POST" ? await request.text() : undefined,
      }),
    );

    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return textError("something went wrong", 500);
  }
}
