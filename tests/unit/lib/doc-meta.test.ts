import { describe, it, expect } from "vitest";
import { extractDocMeta } from "~/lib/doc-meta";

describe("extractDocMeta", () => {
  describe("title", () => {
    it("uses the first heading", () => {
      const { title } = extractDocMeta("intro text\n# My Title\nbody");
      expect(title).toBe("My Title");
    });

    it("handles deeper heading levels", () => {
      expect(extractDocMeta("### Level Three").title).toBe("Level Three");
    });

    it("strips trailing closing hashes from headings", () => {
      expect(extractDocMeta("## Closed Heading ##").title).toBe("Closed Heading");
    });

    it("falls back to the first non-empty line when there is no heading", () => {
      const { title } = extractDocMeta("\n\n  plain first line  \nsecond line");
      expect(title).toBe("plain first line");
    });

    it("returns null for empty content", () => {
      expect(extractDocMeta("").title).toBeNull();
      expect(extractDocMeta("\n \n\t\n").title).toBeNull();
    });

    it("does not treat #hashtag (no space) as a heading", () => {
      expect(extractDocMeta("#hashtag here").title).toBe("#hashtag here");
    });

    it("ignores frontmatter lines when deriving the title", () => {
      const md = "---\nauthor: Alice\ntitle: ignored\n---\n# Real Title";
      expect(extractDocMeta(md).title).toBe("Real Title");
    });

    it("uses first line after frontmatter when no heading", () => {
      const md = "---\nauthor: Alice\n---\n\nfirst body line";
      expect(extractDocMeta(md).title).toBe("first body line");
    });
  });

  describe("author", () => {
    it("reads author from frontmatter", () => {
      const md = "---\nauthor: Alice Smith\n---\n# Doc";
      expect(extractDocMeta(md).author).toBe("Alice Smith");
    });

    it("returns null when there is no frontmatter", () => {
      expect(extractDocMeta("# Doc").author).toBeNull();
    });

    it("returns null when frontmatter has no author", () => {
      const md = "---\ntags: [a, b]\n---\n# Doc";
      expect(extractDocMeta(md).author).toBeNull();
    });

    it("returns null for non-string author values", () => {
      const md = "---\nauthor: [a, b]\n---\n# Doc";
      expect(extractDocMeta(md).author).toBeNull();
    });

    it("ignores malformed YAML frontmatter", () => {
      const md = "---\nauthor: [unclosed\n---\n# Doc";
      const meta = extractDocMeta(md);
      expect(meta.author).toBeNull();
      expect(meta.title).toBe("Doc");
    });

    it("treats unterminated frontmatter as body", () => {
      const md = "---\nauthor: Alice\n# Heading";
      const meta = extractDocMeta(md);
      expect(meta.author).toBeNull();
      expect(meta.title).toBe("Heading");
    });

    it("trims whitespace around the author", () => {
      const md = '---\nauthor: "  Bob  "\n---\ntext';
      expect(extractDocMeta(md).author).toBe("Bob");
    });
  });

  describe("public", () => {
    it("is false by default", () => {
      expect(extractDocMeta("# Doc").isPublic).toBe(false);
    });

    it("reads public: true from frontmatter", () => {
      const md = "---\npublic: true\n---\n# Doc";
      expect(extractDocMeta(md).isPublic).toBe(true);
    });

    it("is false for public: false", () => {
      const md = "---\npublic: false\n---\n# Doc";
      expect(extractDocMeta(md).isPublic).toBe(false);
    });

    it("is false for non-boolean public values", () => {
      const md = '---\npublic: "yes"\n---\n# Doc';
      expect(extractDocMeta(md).isPublic).toBe(false);
    });
  });
});
