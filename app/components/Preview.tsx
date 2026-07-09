import { useMemo, useDeferredValue } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useDocument } from "~/lib/DocumentContext";
import { docFormat } from "~/shared/constants";
import { buildJsxRunnerHtml } from "~/lib/jsx-runner";
import { buildIpynbRunnerHtml } from "~/lib/ipynb-runner";

/** Replace CriticMarkup delimiters with styled HTML spans before markdown rendering */
function renderCriticMarkup(text: string): string {
  return text
    .replace(/\{--(.+?)--\}/g, '<span class="cm-deletion">$1</span>')
    .replace(/\{\+\+(.+?)\+\+\}/g, '<span class="cm-addition">$1</span>')
    .replace(/\{>>(.+?)<<\}/g, '')
    .replace(/\{==(.+?)==\}/g, '<span class="cm-highlight">$1</span>');
}

export default function Preview() {
  const { markdown, docId } = useDocument();
  const format = docFormat(docId);
  // Deferred: while typing in edit+peek the iframe reloads on every
  // change; deferring batches updates under load without a timer.
  const deferredSource = useDeferredValue(markdown);

  const html = useMemo(() => {
    if (format !== "md") return "";
    // DOMPurify needs a DOM; during SSR render empty and let the client fill in
    if (typeof DOMPurify.sanitize !== "function") return "";
    const withCritic = renderCriticMarkup(markdown);
    const raw = marked.parse(withCritic, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [markdown, format]);

  if (format === "html") {
    // srcdoc, not src=/raw: the SameSite=Lax session cookie is not sent on
    // iframe loads, so /raw would bounce to login. The doc text is already
    // synced client-side. Sandbox without allow-same-origin keeps the
    // note's scripts in an opaque origin, away from the viewer's cookies.
    return (
      <iframe
        srcDoc={markdown}
        sandbox="allow-scripts"
        className="h-full min-h-[80vh] w-full border-0"
        title="preview"
      />
    );
  }

  if (format === "jsx" || format === "ipynb") {
    const srcDoc =
      format === "jsx"
        ? buildJsxRunnerHtml(deferredSource)
        : buildIpynbRunnerHtml(deferredSource);
    return (
      <iframe
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        className="h-full min-h-[80vh] w-full border-0"
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
