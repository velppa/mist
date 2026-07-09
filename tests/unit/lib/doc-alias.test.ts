import { describe, it, expect } from "vitest";
import { parseDocId, docSlug, docAliasPath } from "~/shared/constants";

describe("parseDocId", () => {
  it("returns the bare id; extensions are decorative", () => {
    expect(parseDocId("abc12345")).toBe("abc12345");
    expect(parseDocId("abc12345.md")).toBe("abc12345");
    expect(parseDocId("abc12345.txt")).toBe("abc12345");
    expect(parseDocId("abc12345.html")).toBe("abc12345");
    expect(parseDocId("abc12345.jsx")).toBe("abc12345");
    expect(parseDocId("abc12345.ipynb")).toBe("abc12345");
  });

  it("extracts the trailing id from aliased params", () => {
    expect(parseDocId("sapi-override-generator-4q5dalwz.html")).toBe("4q5dalwz");
    expect(parseDocId("my-title-abc12345")).toBe("abc12345");
    expect(parseDocId("a-b-c-abc12345.jsx")).toBe("abc12345");
    expect(parseDocId("my-notebook-abcd1234.ipynb")).toBe("abcd1234");
  });

  it("treats the last segment as authoritative even if the alias looks id-like", () => {
    expect(parseDocId("abcd1234-efgh5678")).toBe("efgh5678");
  });

  it("rejects junk", () => {
    expect(parseDocId("wrongid.html")).toBeNull();
    expect(parseDocId("short-abc123")).toBeNull();
    expect(parseDocId("")).toBeNull();
    expect(parseDocId("alias-ABC12345")).toBeNull();
    expect(parseDocId("alias-abc12345.pdf")).toBeNull();
    expect(parseDocId("no-dash-here9chars")).toBeNull();
    expect(parseDocId("bad-zzz.ipynb")).toBeNull();
  });
});

describe("docSlug", () => {
  it("kebab-cases titles", () => {
    expect(docSlug("SAPI Override Generator")).toBe("sapi-override-generator");
    expect(docSlug("  Hello,   World!  ")).toBe("hello-world");
  });

  it("strips accents and drops non-ascii", () => {
    expect(docSlug("Caf\u00e9 d\u00e9j\u00e0 vu")).toBe("cafe-deja-vu");
    expect(docSlug("\u65e5\u672c\u8a9e\u306e\u307f")).toBe("");
  });

  it("caps length", () => {
    expect(docSlug("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("docAliasPath", () => {
  it("prefixes the slug and appends the format extension", () => {
    expect(docAliasPath("4q5dalwz", "SAPI Override Generator", "html")).toBe(
      "/docs/sapi-override-generator-4q5dalwz.html",
    );
    expect(docAliasPath("abc12345", "My Notes", "md")).toBe(
      "/docs/my-notes-abc12345.md",
    );
  });

  it("falls back to the plain id when the title yields no slug", () => {
    expect(docAliasPath("abc12345", "", "md")).toBe("/docs/abc12345.md");
    expect(docAliasPath("abc12345", null, "txt")).toBe("/docs/abc12345.txt");
    expect(docAliasPath("abc12345", "!!!", "md")).toBe("/docs/abc12345.md");
    expect(docAliasPath("abc12345", "abc12345", "txt")).toBe("/docs/abc12345.txt");
  });

  it("omits the extension when no format is given", () => {
    expect(docAliasPath("abc12345", "My Notes")).toBe("/docs/my-notes-abc12345");
  });

  it("round-trips through parseDocId", () => {
    const path = docAliasPath("4q5dalwz", "SAPI Override Generator", "html");
    expect(parseDocId(path.slice("/docs/".length))).toBe("4q5dalwz");
  });
});
