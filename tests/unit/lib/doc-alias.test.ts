import { describe, it, expect } from "vitest";
import { parseDocId, docSlug, docAliasPath } from "~/shared/constants";

describe("parseDocId", () => {
  it("accepts bare ids for every format", () => {
    expect(parseDocId("abc12345")).toBe("abc12345");
    expect(parseDocId("abc12345.txt")).toBe("abc12345.txt");
    expect(parseDocId("abc12345.html")).toBe("abc12345.html");
    expect(parseDocId("abc12345.jsx")).toBe("abc12345.jsx");
  });

  it("extracts the trailing id from aliased params", () => {
    expect(parseDocId("sapi-override-generator-4q5dalwz.html")).toBe("4q5dalwz.html");
    expect(parseDocId("my-title-abc12345")).toBe("abc12345");
    expect(parseDocId("a-b-c-abc12345.jsx")).toBe("abc12345.jsx");
    expect(parseDocId("x-abc12345.txt")).toBe("abc12345.txt");
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
  });
});

it("parses ipynb ids, bare and aliased", () => {
  expect(parseDocId("abcd1234.ipynb")).toBe("abcd1234.ipynb");
  expect(parseDocId("my-notebook-abcd1234.ipynb")).toBe("abcd1234.ipynb");
  expect(parseDocId("bad-zzz.ipynb")).toBeNull();
});

describe("docSlug", () => {
  it("kebab-cases titles", () => {
    expect(docSlug("SAPI Override Generator")).toBe("sapi-override-generator");
    expect(docSlug("  Hello,   World!  ")).toBe("hello-world");
  });

  it("strips accents and drops non-ascii", () => {
    expect(docSlug("Café déjà vu")).toBe("cafe-deja-vu");
    expect(docSlug("日本語のみ")).toBe("");
  });

  it("caps length", () => {
    expect(docSlug("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("docAliasPath", () => {
  it("prefixes the slug", () => {
    expect(docAliasPath("4q5dalwz.html", "SAPI Override Generator")).toBe(
      "/docs/sapi-override-generator-4q5dalwz.html",
    );
    expect(docAliasPath("abc12345", "My Notes")).toBe("/docs/my-notes-abc12345");
  });

  it("falls back to the plain id", () => {
    expect(docAliasPath("abc12345", "")).toBe("/docs/abc12345");
    expect(docAliasPath("abc12345", null)).toBe("/docs/abc12345");
    expect(docAliasPath("abc12345", "!!!")).toBe("/docs/abc12345");
    expect(docAliasPath("abc12345.txt", "abc12345")).toBe("/docs/abc12345.txt");
  });

  it("round-trips through parseDocId", () => {
    const path = docAliasPath("4q5dalwz.html", "SAPI Override Generator");
    expect(parseDocId(path.slice("/docs/".length))).toBe("4q5dalwz.html");
  });
});
