import { parse as parseYaml } from "yaml";
import type { DocFormat } from "~/shared/constants";

/**
 * Metadata extracted from a markdown document, used to describe it in
 * the document registry (homepage listing).
 */
export interface DocMeta {
  /** Display title, or null when the document has no usable text. */
  title: string | null;
  /** Author from the frontmatter `author` field, or null. */
  author: string | null;
  /**
   * Frontmatter `listed: true` opts the document into the homepage
   * listing. Documents are private (unlisted) by default.
   */
  isListed: boolean;
}

/**
 * Split optional YAML frontmatter from the markdown body. Frontmatter
 * must start on the very first line with `---` and end with a matching
 * `---` line.
 */
function splitFrontmatter(markdown: string): {
  frontmatter: string | null;
  body: string;
} {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: null, body: markdown };
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return {
        frontmatter: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
      };
    }
  }
  // Unterminated frontmatter — treat the whole document as body
  return { frontmatter: null, body: markdown };
}

/**
 * Derive a title from a markdown body: the first heading if present,
 * otherwise the first non-empty line, otherwise null.
 */
function extractTitle(body: string): string | null {
  const lines = body.split("\n");
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      return heading[1];
    }
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Extract registry metadata (title + author + visibility) from raw
 * markdown text. Never throws — malformed frontmatter is ignored.
 */
export function extractDocMeta(markdown: string): DocMeta {
  const { frontmatter, body } = splitFrontmatter(markdown);

  let author: string | null = null;
  let isListed = false;
  if (frontmatter) {
    try {
      const data: unknown = parseYaml(frontmatter);
      if (data && typeof data === "object") {
        const value = (data as Record<string, unknown>).author;
        if (typeof value === "string" && value.trim()) {
          author = value.trim();
        }
        isListed = (data as Record<string, unknown>).listed === true;
      }
    } catch {
      // Malformed YAML — no author, but the document is still valid
    }
  }

  return { title: extractTitle(body), author, isListed };
}

/** Title of an HTML document: <title>, else first <h1>, else null. */
function extractHtmlTitle(html: string): string | null {
  for (const tag of ["title", "h1"]) {
    const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    if (m) {
      const text = m[1].replace(/<[^>]+>/g, "").trim();
      if (text) return text;
    }
  }
  return null;
}

/**
 * Format-aware registry metadata. Frontmatter (author/listed) is a
 * markdown concept; txt and html notes only get a title.
 */
export function extractDocMetaForFormat(
  text: string,
  format: DocFormat,
): DocMeta {
  switch (format) {
    case "md":
      return extractDocMeta(text);
    case "txt": {
      const first = text.split("\n").find((line) => line.trim());
      return { title: first?.trim() ?? null, author: null, isListed: false };
    }
    case "html":
      return { title: extractHtmlTitle(text), author: null, isListed: false };
    case "jsx": {
      // First meaningful line: skip blanks and import/export statements,
      // strip comment decorations
      const first = text.split("\n").find((line) => {
        const t = line.trim();
        return t && !/^(import|export)\b/.test(t);
      });
      const title = first
        ?.trim()
        .replace(/^\/\/+\s*|^\/\*+\s*|^\*+\s*/, "")
        .replace(/\s*\*\/\s*$/, "")
        .trim();
      return { title: title || null, author: null, isListed: false };
    }
    case "ipynb": {
      // First markdown heading in the notebook; raw JSON never makes a title
      try {
        const nb = JSON.parse(text) as {
          cells?: Array<{ cell_type?: string; source?: string | string[] }>;
        };
        for (const cell of nb.cells ?? []) {
          if (cell.cell_type !== "markdown") continue;
          const src = Array.isArray(cell.source)
            ? cell.source.join("")
            : (cell.source ?? "");
          const m = src.match(/^#+\s+(.+)$/m);
          if (m) return { title: m[1].trim(), author: null, isListed: false };
        }
      } catch {
        // Malformed notebook — untitled
      }
      return { title: null, author: null, isListed: false };
    }
  }
}
