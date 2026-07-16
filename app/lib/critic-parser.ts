import { parseCriticRanges } from "./critic-markup";

export interface ParsedMark {
  from: number;
  to: number;
  type: string;
  attrs?: Record<string, unknown>;
}

/**
 * Reduce CriticMarkup to the underlying document text: delimiters drop,
 * marked text stays, and comments — annotations, not content — vanish
 * entirely. Source-format previews (html/jsx/ipynb) need this so review
 * markup never leaks into code that gets parsed or executed.
 */
export function stripCriticMarkup(text: string): string {
  return text
    .replace(/\{--(.*?)--\}/gs, "$1")
    .replace(/\{\+\+(.*?)\+\+\}/gs, "$1")
    .replace(/\{>>.*?<<\}/gs, "")
    .replace(/\{==(.*?)==\}/gs, "$1");
}

/**
 * Parse CriticMarkup text into clean text + mark ranges.
 * Used by the agent's POST handler to populate Yjs docs with marks.
 *
 * Throws on unsupported substitution syntax ({~~old~>new~~}).
 */
export function parseCriticMarkupToContent(text: string): {
  cleanText: string;
  marks: ParsedMark[];
} {
  const ranges = parseCriticRanges(text);

  // Check for unsupported substitution
  const sub = ranges.find((r) => r.type === "substitution");
  if (sub) {
    throw new Error(
      "Unsupported CriticMarkup: substitution ({~~old~>new~~}) is not supported. " +
        "Use separate deletion and addition instead: {--old--}{++new++}",
    );
  }

  const marks: ParsedMark[] = [];
  let cleanText = "";
  let cursor = 0;

  // Process ranges in order, stripping delimiters and recording marks
  for (const range of ranges) {
    // Append any text before this range
    cleanText += text.slice(cursor, range.start);

    const cleanStart = cleanText.length;

    switch (range.type) {
      case "addition":
        cleanText += range.content.addition;
        marks.push({
          from: cleanStart,
          to: cleanText.length,
          type: "criticAddition",
        });
        break;
      case "deletion":
        cleanText += range.content.deletion;
        marks.push({
          from: cleanStart,
          to: cleanText.length,
          type: "criticDeletion",
        });
        break;
      case "comment":
        cleanText += range.content.comment;
        marks.push({
          from: cleanStart,
          to: cleanText.length,
          type: "criticComment",
        });
        break;
      case "highlight":
        cleanText += range.content.highlight;
        marks.push({
          from: cleanStart,
          to: cleanText.length,
          type: "criticHighlight",
        });
        break;
    }

    cursor = range.end;
  }

  // Append remaining text
  cleanText += text.slice(cursor);

  return { cleanText, marks };
}
