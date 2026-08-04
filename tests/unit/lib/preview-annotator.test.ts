import { describe, it, expect } from "vitest";
import { createAnchorKit, buildAnnotatorScript } from "~/lib/preview-annotator";

const kit = createAnchorKit();

describe("anchor kit", () => {
  describe("normalizeQuote", () => {
    it("collapses whitespace and trims", () => {
      expect(kit.normalizeQuote("  hello\n  world  ")).toBe("hello world");
    });

    it("caps very long quotes", () => {
      expect(kit.normalizeQuote("x".repeat(600)).length).toBe(kit.MAX_QUOTE_LENGTH);
    });
  });

  describe("normalizeWithOffsets", () => {
    it("maps normalized indices back to the original text", () => {
      const { normalized, offsets } = kit.normalizeWithOffsets("Foo  \n Bar");
      expect(normalized).toBe("foo bar");
      expect(offsets[normalized.indexOf("bar")]).toBe(7);
      // Trailing entry maps a match end past the last matched char
      expect(offsets[normalized.length]).toBe(10);
    });
  });

  describe("findQuoteMatches", () => {
    it("matches case- and whitespace-insensitively over the original text", () => {
      const text = "The Quick   brown fox";
      const matches = kit.findQuoteMatches(text, "quick brown");
      expect(matches).toHaveLength(1);
      expect(text.slice(matches[0].start, matches[0].end)).toBe("Quick   brown");
    });

    it("returns every occurrence in document order", () => {
      const matches = kit.findQuoteMatches("ab cd ab cd", "cd");
      expect(matches.map((m) => m.start)).toEqual([3, 9]);
    });

    it("returns nothing for an empty quote", () => {
      expect(kit.findQuoteMatches("abc", "   ")).toEqual([]);
    });
  });

  describe("chooseMatch", () => {
    const anchor = (quote: string, extra: Partial<ReturnType<typeof base>> = {}) => ({
      ...base(quote),
      ...extra,
    });
    const base = (quote: string) => ({
      quote,
      prefix: "",
      suffix: "",
      posStart: 0,
      posEnd: quote.length,
    });

    it("resolves a unique quote", () => {
      const text = "alpha beta gamma";
      const match = kit.chooseMatch(text, anchor("beta"));
      expect(match && text.slice(match.start, match.end)).toBe("beta");
    });

    it("disambiguates duplicates by context", () => {
      const text = "red apple pie and red apple cake";
      const match = kit.chooseMatch(text, anchor("red apple", { suffix: "cake" }));
      expect(match?.start).toBe(18);
    });

    it("falls back to the position hint when context ties", () => {
      const text = "one two one two";
      const match = kit.chooseMatch(text, anchor("two", { posStart: 12, posEnd: 15 }));
      expect(match?.start).toBe(12);
    });

    it("returns null when nothing matches", () => {
      expect(kit.chooseMatch("alpha beta", anchor("gamma"))).toBeNull();
    });
  });

  describe("captureSelectors", () => {
    it("captures the quote with its surrounding context", () => {
      const text = "before-context THE QUOTE after-context";
      const sel = kit.captureSelectors(text, { start: 15, end: 24 });
      expect(sel.quote).toBe("THE QUOTE");
      expect(sel.prefix).toBe("before-context");
      expect(sel.suffix).toBe("after-context");
      expect(sel.posStart).toBe(15);
      expect(sel.posEnd).toBe(24);
    });

    it("round-trips: captured selectors resolve back to the same range", () => {
      const text = "one two three two one";
      const sel = kit.captureSelectors(text, { start: 14, end: 17 });
      const match = kit.chooseMatch(text, sel);
      expect(match).toEqual({ start: 14, end: 17 });
    });
  });
});

describe("buildAnnotatorScript", () => {
  it("produces a self-contained script tag", () => {
    const script = buildAnnotatorScript();
    expect(script.startsWith("<script>")).toBe(true);
    expect(script.endsWith("</script>")).toBe(true);
    // Nothing inside may terminate the tag early
    expect(script.slice(8, -9)).not.toContain("</script");
    // Serialized functions must not reference module imports
    expect(script).not.toContain("import ");
  });
});
