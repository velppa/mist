import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useDocument } from "~/lib/DocumentContext";

/** Replace CriticMarkup delimiters with styled HTML spans before markdown rendering */
function renderCriticMarkup(text: string): string {
  return text
    .replace(/\{--(.+?)--\}/g, '<span class="cm-deletion">$1</span>')
    .replace(/\{\+\+(.+?)\+\+\}/g, '<span class="cm-addition">$1</span>')
    .replace(/\{>>(.+?)<<\}/g, '')
    .replace(/\{==(.+?)==\}/g, '<span class="cm-highlight">$1</span>');
}

export default function Preview() {
  const { markdown } = useDocument();

  const html = useMemo(() => {
    // DOMPurify needs a DOM; during SSR render empty and let the client fill in
    if (typeof DOMPurify.sanitize !== "function") return "";
    const withCritic = renderCriticMarkup(markdown);
    const raw = marked.parse(withCritic, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [markdown]);

  return (
    <div
      className="preview font-serif"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
