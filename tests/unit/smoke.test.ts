import { describe, it, expect } from "vitest";
import {
  APP_NAME,
  isValidDocumentId,
  effectiveFormat,
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
  it("ids are bare — extensions are not part of the id", () => {
    expect(isValidDocumentId("abcd1234.txt")).toBe(false);
    expect(isValidDocumentId("abcd1234.md")).toBe(false);
    expect(isValidDocumentId(".txt")).toBe(false);
    expect(isValidDocumentId("abcd12345")).toBe(false);
  });

  it("effective format comes from stored state, defaulting to md", () => {
    expect(effectiveFormat("txt")).toBe("txt");
    expect(effectiveFormat("ipynb")).toBe("ipynb");
    expect(effectiveFormat(undefined)).toBe("md");
    expect(effectiveFormat(null)).toBe("md");
    expect(effectiveFormat("weird")).toBe("md");
  });
});
