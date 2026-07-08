import { data } from "react-router";
import { getAgentByName } from "agents";
import type { Route } from "./+types/raw.$id";
import { isValidDocumentId, docFormat } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";

const CONTENT_TYPES = {
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8",
} as const;

/** Serve the document text verbatim, typed by the id's format suffix. */
export async function loader({ params, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id)) {
    throw data(null, { status: 404 });
  }

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request("https://do/?include=text"));
  const { exists, text } = (await res.json()) as {
    exists: boolean;
    text?: string;
  };

  if (!exists) {
    throw data(null, { status: 404 });
  }

  const format = docFormat(id);
  const headers = new Headers({
    "Content-Type": CONTENT_TYPES[format],
    "X-Content-Type-Options": "nosniff",
  });
  if (format === "html") {
    // Render in an opaque origin: document scripts must not reach mist
    // with the viewer's cookies (auth/token endpoints).
    headers.set("Content-Security-Policy", "sandbox allow-scripts");
  }

  return new Response(text ?? "", { headers });
}
