import { describe, it, expect } from "vitest";
import { extractDocMeta, extractDocMetaForFormat } from "~/lib/doc-meta";

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

  it("keeps the frontmatter out of the title", () => {
    const md = "---\nauthor: Alice Smith\n---\n# Doc";
    expect(extractDocMeta(md).title).toBe("Doc");
  });

  it("treats unterminated frontmatter as body", () => {
    expect(extractDocMeta("---\nauthor: Alice\n# Heading").title).toBe("Heading");
  });
});

describe("extractDocMetaForFormat", () => {
  it("txt: first non-empty line is the title", () => {
    const meta = extractDocMetaForFormat("\n\nshopping list\nmilk", "txt");
    expect(meta).toEqual({ title: "shopping list" });
  });

  it("txt: frontmatter-looking text is just text", () => {
    const meta = extractDocMetaForFormat("---\nauthor: a@b.c\n---\nbody", "txt");
    expect(meta.title).toBe("---");
  });

  it("html: <title> wins", () => {
    const meta = extractDocMetaForFormat(
      "<html><head><title>My Page</title></head><body><h1>Other</h1></body></html>",
      "html",
    );
    expect(meta.title).toBe("My Page");
  });

  it("html: falls back to first h1, tags stripped", () => {
    const meta = extractDocMetaForFormat(
      "<body><h1>Hello <em>world</em></h1></body>",
      "html",
    );
    expect(meta.title).toBe("Hello world");
  });

  it("html: null title when neither present", () => {
    expect(extractDocMetaForFormat("<p>hi</p>", "html").title).toBeNull();
  });

  it("md: delegates to the markdown extractor", () => {
    expect(extractDocMetaForFormat("---\nauthor: a@b.c\n---\n# T", "md").title).toBe("T");
  });
});

describe("extractDocMetaForFormat: jsx", () => {
  it("uses the first meaningful line, skipping imports", () => {
    const meta = extractDocMetaForFormat(
      '\nimport { useState } from "react";\nconst GFONT = "x";\nmore',
      "jsx",
    );
    expect(meta.title).toBe('const GFONT = "x";');
  });

  it("strips comment decorations", () => {
    expect(extractDocMetaForFormat("// My Component\ncode", "jsx").title).toBe(
      "My Component",
    );
    expect(extractDocMetaForFormat("/* Header */\ncode", "jsx").title).toBe(
      "Header",
    );
    expect(extractDocMetaForFormat(" * Doc line\ncode", "jsx").title).toBe(
      "Doc line",
    );
  });

  it("returns null for empty source", () => {
    expect(extractDocMetaForFormat("", "jsx").title).toBeNull();
  });
});

describe("extractDocMetaForFormat: ipynb", () => {
  it("uses the first markdown heading", () => {
    const nb = JSON.stringify({
      nbformat: 4,
      cells: [
        { cell_type: "code", source: ["1+1"] },
        { cell_type: "markdown", source: ["intro text\n", "# Real Title\n"] },
      ],
    });
    expect(extractDocMetaForFormat(nb, "ipynb").title).toBe("Real Title");
  });

  it("falls back to null without markdown headings", () => {
    const nb = JSON.stringify({
      nbformat: 4,
      cells: [{ cell_type: "code", source: ["print(1)"] }],
    });
    expect(extractDocMetaForFormat(nb, "ipynb").title).toBeNull();
  });

  it("never titles from malformed JSON", () => {
    expect(extractDocMetaForFormat("{not json", "ipynb").title).toBeNull();
  });
});
