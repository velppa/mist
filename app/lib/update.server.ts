import { getAgentByName } from "agents";
import { parseDocId, docFormat } from "~/shared/constants";
import { deserializeThreads } from "~/lib/thread-serialization";
import { authenticateNewRequest, type AuthEnv } from "~/lib/auth.server";
import { readUploadBody, textError } from "~/lib/upload.server";

interface UpdateEnv extends AuthEnv {
  DocumentAgent: Parameters<typeof getAgentByName>[0];
}

/**
 * PUT /docs/:id — replace the document content via API:
 *   curl -X PUT -H "Authorization: Bearer <token>" -T file.md <host>/docs/<id>
 * Handled in the worker entry (not a React Router action) so curl gets a
 * plain-text response instead of the rendered page. Rejected with 409
 * while the document has unresolved comments or pending suggestions.
 */
export async function handleDocUpdate(request: Request, env: unknown): Promise<Response> {
  try {
    const url = new URL(request.url);
    const id = parseDocId(decodeURIComponent(url.pathname.slice("/docs/".length)));
    if (!id) {
      return textError("document not found", 404);
    }

    const authEnv = env as UpdateEnv;
    const auth = await authenticateNewRequest(request, authEnv);
    if (!auth.ok) {
      return textError(auth.message, 401);
    }

    const content = await readUploadBody(request);
    if (content instanceof Response) {
      return content;
    }

    const payload =
      docFormat(id) === "md"
        ? (() => {
            const { body, threads } = deserializeThreads(content);
            return { content: body, threads };
          })()
        : { content };

    const stub = await getAgentByName(authEnv.DocumentAgent, id);
    const res = await stub.fetch(
      new Request("https://do/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    if (!res.ok) {
      try {
        const err = (await res.json()) as { error?: string };
        return textError(err.error ?? "failed to update document", res.status);
      } catch {
        return textError("failed to update document", res.status);
      }
    }

    return new Response(`${url.origin}/docs/${id}\n`, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch {
    return textError("something went wrong", 500);
  }
}
