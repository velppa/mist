import { getAgentByName } from "agents";
import { parseDocId } from "~/shared/constants";

/** Pages that serve a public document to readers who are not signed in. */
const PUBLIC_PAGE = /^\/(raw|render)\/([^/]+)$/;

/**
 * Whether this path is a /raw or /render page of a document marked
 * public, so it may be served without signing in.
 */
export async function isPublicDocumentPage(
  pathname: string,
  env: { DocumentAgent?: unknown },
): Promise<boolean> {
  const match = pathname.match(PUBLIC_PAGE);
  if (!match || !env.DocumentAgent) return false;
  const id = parseDocId(decodeURIComponent(match[2]));
  if (!id) return false;
  try {
    const stub = await getAgentByName(
      env.DocumentAgent as Parameters<typeof getAgentByName>[0],
      id,
    );
    const res = await stub.fetch(new Request("https://do/"));
    if (!res.ok) return false;
    const { exists, publicAccess } = (await res.json()) as {
      exists?: boolean;
      publicAccess?: boolean;
    };
    return exists === true && publicAccess === true;
  } catch {
    return false;
  }
}
