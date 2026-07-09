import { getAgentByName } from "agents";
import { parseDocId } from "~/shared/constants";
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

    // The document knows its own format (live, switchable state), so
    // the body is passed through raw and interpreted there.
    const payload = { content };

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

/**
 * POST /docs/:id/listed — set the homepage-visibility flag via API.
 * The single write path for every listed toggle in the UI; the change
 * reaches open editors through the document's server-origin broadcast.
 */
export async function handleListedUpdate(request: Request, env: unknown): Promise<Response> {
  try {
    const url = new URL(request.url);
    const param = decodeURIComponent(
      url.pathname.slice("/docs/".length, -"/listed".length),
    );
    const id = parseDocId(param);
    if (!id) {
      return textError("document not found", 404);
    }

    const authEnv = env as UpdateEnv;
    const auth = await authenticateNewRequest(request, authEnv);
    if (!auth.ok) {
      return textError(auth.message, 401);
    }

    const stub = await getAgentByName(authEnv.DocumentAgent, id);
    const res = await stub.fetch(
      new Request("https://do/listed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await request.text(),
      }),
    );

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return textError("something went wrong", 500);
  }
}
