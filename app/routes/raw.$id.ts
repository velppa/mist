import { data } from "react-router";
import { getAgentByName } from "agents";
import { marked } from "marked";
import type { Route } from "./+types/raw.$id";
import { parseDocId, docFormat } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { buildJsxRunnerHtml } from "~/lib/jsx-runner";
import { buildIpynbRunnerHtml } from "~/lib/ipynb-runner";

const SOURCE_CONTENT_TYPES = {
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  jsx: "text/plain; charset=utf-8",
  ipynb: "text/plain; charset=utf-8",
  // Source view must display the markup, not render it
  html: "text/plain; charset=utf-8",
} as const;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal self-contained shell for server-rendered markdown. */
function markdownPage(title: string, text: string): string {
  const body = marked.parse(text, { async: false }) as string;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 72ch;
         margin: 2rem auto; padding: 0 1rem; line-height: 1.7;
         background: #fafaf8; color: #1a1a1a; }
  h1, h2, h3, h4 { line-height: 1.3; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  code { background: #ececea; padding: .1em .3em; border-radius: 2px; font-size: .9em; }
  pre { background: #ececea; padding: 1em; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #555; }
  a { color: inherit; }
  img { max-width: 100%; }
  @media (prefers-color-scheme: dark) {
    body { background: #161615; color: #e8e8e6; }
    code, pre { background: #2a2a28; }
    blockquote { border-color: #444; color: #aaa; }
  }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Serve the document. Default: the rendered page (html verbatim, jsx
 * via the shared runner, markdown server-rendered, txt as-is). With
 * ?source=true: the verbatim source for every format.
 */
export async function loader({ params, context, request }: Route.LoaderArgs) {
  const id = parseDocId(params.id);
  if (!id) {
    throw data(null, { status: 404 });
  }

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request("https://do/?include=text"));
  const { exists, text, title } = (await res.json()) as {
    exists: boolean;
    text?: string;
    title?: string | null;
  };

  if (!exists) {
    throw data(null, { status: 404 });
  }

  const format = docFormat(id);
  const source = new URL(request.url).searchParams.get("source") === "true";
  const headers = new Headers({ "X-Content-Type-Options": "nosniff" });

  if (source || format === "txt") {
    headers.set(
      "Content-Type",
      source ? SOURCE_CONTENT_TYPES[format] : SOURCE_CONTENT_TYPES.txt,
    );
    return new Response(text ?? "", { headers });
  }

  // Rendered pages carry user-authored markup/scripts: serve them in an
  // opaque origin so nothing can reach mist with the viewer's cookies.
  // For markdown this sandbox is also the XSS containment — DOMPurify
  // needs a DOM and cannot run in the worker.
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", "sandbox allow-scripts");

  const body =
    format === "html"
      ? (text ?? "")
      : format === "jsx"
        ? buildJsxRunnerHtml(text ?? "")
        : format === "ipynb"
          ? buildIpynbRunnerHtml(text ?? "")
          : markdownPage(title ?? id, text ?? "");

  return new Response(body, { headers });
}
