import { useMemo, useDeferredValue } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useDocument } from "~/lib/DocumentContext";
import { splitFrontmatter } from "~/lib/doc-meta";
import { buildJsxRunnerHtml } from "~/lib/jsx-runner";
import { buildIpynbRunnerHtml } from "~/lib/ipynb-runner";
import { headingAnchors } from "~/lib/heading-anchors";
import { stripCriticMarkup } from "~/lib/critic-parser";

marked.use(headingAnchors());

/** Replace CriticMarkup delimiters with styled HTML spans before markdown rendering */
function renderCriticMarkup(text: string): string {
  return text
    .replace(/\{--(.+?)--\}/g, '<span class="cm-deletion">$1</span>')
    .replace(/\{\+\+(.+?)\+\+\}/g, '<span class="cm-addition">$1</span>')
    .replace(/\{>>(.+?)<<\}/g, '')
    .replace(/\{==(.+?)==\}/g, '<span class="cm-highlight">$1</span>');
}

export default function Preview() {
  const { markdown, format } = useDocument();
  // Deferred: while typing in edit+peek the iframe reloads on every
  // change; deferring batches updates under load without a timer.
  const deferredSource = useDeferredValue(markdown);

  const html = useMemo(() => {
    if (format !== "md") return "";
    // DOMPurify needs a DOM; during SSR render empty and let the client fill in
    if (typeof DOMPurify.sanitize !== "function") return "";
    // Frontmatter is metadata, not prose — shown as a muted block
    // instead of letting marked mangle it into setext headings.
    const { frontmatter, body } = splitFrontmatter(markdown);
    const withCritic = renderCriticMarkup(body);
    const raw = marked.parse(withCritic, { async: false }) as string;
    const fmHtml = frontmatter
      ? `<pre class="frontmatter">${frontmatter
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</pre>`
      : "";
    return DOMPurify.sanitize(fmHtml + raw);
  }, [markdown, format]);

  if (format === "html") {
    // srcdoc, not src=/raw: the SameSite=Lax session cookie is not sent on
    // iframe loads, so /raw would bounce to login. The doc text is already
    // synced client-side. Sandbox without allow-same-origin keeps the
    // note's scripts in an opaque origin, away from the viewer's cookies.
    return (
      <iframe
        srcDoc={stripCriticMarkup(markdown)}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        className="h-full w-full border-0"
        title="preview"
      />
    );
  }

  if (format === "jsx" || format === "ipynb") {
    // Before the first Yjs sync the text is empty; an empty notebook
    // would render as a JSON parse error, so show a placeholder.
    if (!deferredSource.trim()) {
      return <p className="p-6 text-muted">Loading document…</p>;
    }
    const source = stripCriticMarkup(deferredSource);
    const srcDoc =
      format === "jsx"
        ? buildJsxRunnerHtml(source)
        : buildIpynbRunnerHtml(source);
    return (
      <iframe
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        className="h-full w-full border-0"
        title="preview"
      />
    );
  }

  if (format === "txt") {
    return (
      <pre className="preview whitespace-pre-wrap font-mono">{markdown}</pre>
    );
  }

  return (
    <div
      className="preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
