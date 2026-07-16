import { marked } from "marked";
import { splitFrontmatter } from "~/lib/doc-meta";
import { headingAnchors } from "~/lib/heading-anchors";

marked.use(headingAnchors());

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SHELL_STYLE = `
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 72ch;
         margin: 2rem auto; padding: 0 1rem; line-height: 1.7;
         background: #fafaf8; color: #1a1a1a; }
  h1, h2, h3, h4 { line-height: 1.3; }
  .heading-anchor { opacity: 0; text-decoration: none; color: #999; font-weight: 400; }
  :is(h1,h2,h3,h4,h5,h6):hover .heading-anchor,
  .heading-anchor:focus { opacity: 1; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  code { background: #ececea; padding: .1em .3em; border-radius: 2px; font-size: .9em; }
  pre { background: #ececea; padding: 1em; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  pre.frontmatter { background: none; border: 1px solid #ddd; color: #777;
                    font-size: .85em; padding: .6em 1em; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #555; }
  a { color: inherit; }
  img { max-width: 100%; }
  table { border-collapse: collapse; margin: 1em 0; font-size: .95em; }
  th, td { padding: .4em .8em; text-align: left; vertical-align: top; }
  th { border-bottom: 2px solid #ccc; }
  td { border-bottom: 1px solid #e4e4e1; }
  tbody tr:nth-child(even) { background: #f1f1ee; }
  @media (prefers-color-scheme: dark) {
    body { background: #161615; color: #e8e8e6; }
    code, pre { background: #2a2a28; }
    blockquote { border-color: #444; color: #aaa; }
    th { border-color: #555; }
    td { border-color: #333; }
    tbody tr:nth-child(even) { background: #201f1e; }
  }`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${SHELL_STYLE}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Minimal self-contained page for server-rendered markdown. */
export function markdownPage(title: string, text: string): string {
  // Frontmatter is metadata, not prose — shown as a muted block
  // instead of letting marked mangle it into setext headings.
  const { frontmatter, body: mdBody } = splitFrontmatter(text);
  const fmHtml = frontmatter
    ? `<pre class="frontmatter">${escapeHtml(frontmatter)}</pre>`
    : "";
  return shell(title, fmHtml + (marked.parse(mdBody, { async: false }) as string));
}

/** Plain-text note as a readable page, matching the preview's look. */
export function textPage(title: string, text: string): string {
  return shell(
    title,
    `<pre style="background: none; padding: 0; white-space: pre-wrap;">${escapeHtml(text)}</pre>`,
  );
}
