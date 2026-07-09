import { describe, it, expect } from "vitest";
import {
  APP_NAME,
  isValidDocumentId,
  docFormat,
} from "~/shared/constants";

describe("scaffolding", () => {
  it("exports app name", () => {
    expect(APP_NAME).toBe("mist");
  });
});

describe("isValidDocumentId", () => {
  it("accepts valid 8-char lowercase alphanumeric IDs", () => {
    expect(isValidDocumentId("abcd1234")).toBe(true);
  });

  it("rejects IDs that are too short", () => {
    expect(isValidDocumentId("abc")).toBe(false);
  });

  it("rejects IDs with uppercase letters", () => {
    expect(isValidDocumentId("ABCD1234")).toBe(false);
  });
});

describe("document formats", () => {
  it("accepts txt, html and jsx id suffixes", () => {
    expect(isValidDocumentId("abcd1234.txt")).toBe(true);
    expect(isValidDocumentId("abcd1234.html")).toBe(true);
    expect(isValidDocumentId("abcd1234.jsx")).toBe(true);
    expect(isValidDocumentId("abcd1234.pdf")).toBe(false);
    expect(isValidDocumentId(".txt")).toBe(false);
    expect(isValidDocumentId("abcd12345.txt")).toBe(false);
  });

  it("derives the format from the id suffix", () => {
    expect(docFormat("abcd1234")).toBe("md");
    expect(docFormat("abcd1234.txt")).toBe("txt");
    expect(docFormat("abcd1234.html")).toBe("html");
    expect(docFormat("abcd1234.jsx")).toBe("jsx");
  });
});
