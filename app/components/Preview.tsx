import { useMemo, useDeferredValue, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useDocument } from "~/lib/DocumentContext";
import { splitFrontmatter } from "~/lib/doc-meta";
import { buildJsxRunnerHtml } from "~/lib/jsx-runner";
import { buildIpynbRunnerHtml } from "~/lib/ipynb-runner";
import { headingAnchors } from "~/lib/heading-anchors";
import { stripCriticMarkup } from "~/lib/critic-parser";
import { useInlineAnnotator } from "~/lib/useInlineAnnotator";
import HtmlPreview, { SandboxedPreview } from "~/components/HtmlPreview";

marked.use(headingAnchors());

/** Replace CriticMarkup delimiters with styled HTML spans before markdown rendering */
function renderCriticMarkup(text: string): string {
  return text
    .replace(/\{--(.+?)--\}/g, '<span class="cm-deletion">$1</span>')
    .replace(/\{\+\+(.+?)\+\+\}/g, '<span class="cm-addition">$1</span>')
    .replace(/\{>>(.+?)<<\}/g, '')
    .replace(/\{==(.+?)==\}/g, '<span class="cm-highlight">$1</span>');
}

/** Rendered markdown with anchored comments over the same-origin DOM. */
function MarkdownPreview({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useInlineAnnotator(ref, html);
  return (
    <div
      ref={ref}
      className="preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Plain text with anchored comments over the same-origin DOM. */
function TextPreview({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useInlineAnnotator(ref, text);
  return (
    <div ref={ref}>
      <pre className="preview whitespace-pre-wrap font-mono">{text}</pre>
    </div>
  );
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
    return <HtmlPreview />;
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
    return <SandboxedPreview srcDoc={srcDoc} />;
  }

  if (format === "txt") {
    return <TextPreview text={markdown} />;
  }

  return <MarkdownPreview html={html} />;
}
