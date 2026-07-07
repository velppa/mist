import { parse as parseYaml } from "yaml";

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
   * Frontmatter `public: true` opts the document into the homepage
   * listing. Documents are private (unlisted) by default.
   */
  isPublic: boolean;
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
  let isPublic = false;
  if (frontmatter) {
    try {
      const data: unknown = parseYaml(frontmatter);
      if (data && typeof data === "object") {
        const value = (data as Record<string, unknown>).author;
        if (typeof value === "string" && value.trim()) {
          author = value.trim();
        }
        isPublic = (data as Record<string, unknown>).public === true;
      }
    } catch {
      // Malformed YAML — no author, but the document is still valid
    }
  }

  return { title: extractTitle(body), author, isPublic };
}
