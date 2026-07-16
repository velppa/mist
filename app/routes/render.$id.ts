import { data } from "react-router";
import { getAgentByName } from "agents";
import type { Route } from "./+types/render.$id";
import { parseDocId, effectiveFormat } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { buildJsxRunnerHtml } from "~/lib/jsx-runner";
import { buildIpynbRunnerHtml } from "~/lib/ipynb-runner";
import { markdownPage, textPage } from "~/lib/render-pages";

/**
 * Serve the document rendered to an HTML page: markdown through marked,
 * jsx/ipynb through their runner pages, html verbatim, txt preformatted.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const id = parseDocId(params.id);
  if (!id) {
    throw data(null, { status: 404 });
  }

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request("https://do/?include=text"));
  const { exists, text, title, format: storedFormat } = (await res.json()) as {
    exists: boolean;
    text?: string;
    title?: string | null;
    format?: string;
  };

  if (!exists) {
    throw data(null, { status: 404 });
  }

  const format = effectiveFormat(storedFormat);
  const source = text ?? "";

  const body =
    format === "html"
      ? source
      : format === "jsx"
        ? buildJsxRunnerHtml(source)
        : format === "ipynb"
          ? buildIpynbRunnerHtml(source, title ?? id)
          : format === "txt"
            ? textPage(title ?? id, source)
            : markdownPage(title ?? id, source);

  // Rendered pages carry user-authored markup/scripts: serve them in an
  // opaque origin so nothing can reach mist with the viewer's cookies.
  // For markdown this sandbox is also the XSS containment — DOMPurify
  // needs a DOM and cannot run in the worker.
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
