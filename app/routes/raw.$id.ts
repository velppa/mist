import { data } from "react-router";
import { getAgentByName } from "agents";
import type { Route } from "./+types/raw.$id";
import { parseDocId, effectiveFormat } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";

const RAW_CONTENT_TYPES = {
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  // No standard renderable mime for JSX; text/plain displays in-browser
  jsx: "text/plain; charset=utf-8",
  ipynb: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
} as const;

/** Serve the verbatim document source with its format's content type. */
export async function loader({ params, context }: Route.LoaderArgs) {
  const id = parseDocId(params.id);
  if (!id) {
    throw data(null, { status: 404 });
  }

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request("https://do/?include=text"));
  const { exists, text, format: storedFormat } = (await res.json()) as {
    exists: boolean;
    text?: string;
    format?: string;
  };

  if (!exists) {
    throw data(null, { status: 404 });
  }

  const format = effectiveFormat(storedFormat);
  const headers = new Headers({
    "X-Content-Type-Options": "nosniff",
    "Content-Type": RAW_CONTENT_TYPES[format],
  });
  if (format === "html") {
    // Raw html renders as html; the sandbox keeps the note's scripts in
    // an opaque origin, away from the viewer's mist session.
    headers.set("Content-Security-Policy", "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox");
  }

  return new Response(text ?? "", { headers });
}
