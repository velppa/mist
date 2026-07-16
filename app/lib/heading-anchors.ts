import type { MarkedExtension, Tokens } from "marked";

/**
 * GitHub-style anchor slug for a heading's text: lowercase, punctuation
 * stripped, spaces become hyphens. Unicode letters survive so non-Latin
 * headings still get usable anchors.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Marked extension that gives every heading an `id` anchor, so
 * table-of-contents links (`[…](#section)`) resolve, plus a trailing
 * `#` permalink to that anchor. Duplicate headings get `-1`, `-2`…
 * suffixes, matching GitHub's scheme.
 */
export function headingAnchors(): MarkedExtension {
  let seen = new Map<string, number>();
  return {
    hooks: {
      // A fresh document restarts duplicate counting.
      preprocess(markdown: string) {
        seen = new Map();
        return markdown;
      },
    },
    renderer: {
      heading({ tokens, depth, text }: Tokens.Heading) {
        const base = slugify(text);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        const body = this.parser.parseInline(tokens);
        const link = `<a class="heading-anchor" href="#${id}" aria-label="Permalink to this heading">#</a>`;
        return `<h${depth} id="${id}">${body} ${link}</h${depth}>\n`;
      },
    },
  };
}
