import { describe, it, expect } from "vitest";
import { parseDocWidth, clearDocWidth, WIDTH_PARAM } from "~/lib/doc-width";

describe("parseDocWidth", () => {
  it("returns null when no param is present", () => {
    expect(parseDocWidth(new URLSearchParams())).toBeNull();
  });

  it("returns each supported width", () => {
    expect(parseDocWidth(new URLSearchParams("width=full"))).toBe("full");
    expect(parseDocWidth(new URLSearchParams("width=120"))).toBe("120");
    expect(parseDocWidth(new URLSearchParams("width=65"))).toBe("65");
  });

  it("ignores unknown values", () => {
    expect(parseDocWidth(new URLSearchParams("width=banana"))).toBeNull();
    expect(parseDocWidth(new URLSearchParams("width="))).toBeNull();
    expect(parseDocWidth(new URLSearchParams("width=FULL"))).toBeNull();
    expect(parseDocWidth(new URLSearchParams("width=80"))).toBeNull();
  });

  it("ignores unrelated params", () => {
    expect(parseDocWidth(new URLSearchParams("view=edit"))).toBeNull();
    expect(parseDocWidth(new URLSearchParams("view=edit&width=65"))).toBe("65");
  });
});

describe("clearDocWidth", () => {
  it("drops the width param and keeps the rest", () => {
    const next = clearDocWidth(new URLSearchParams("view=edit&width=65"));
    expect(next.get(WIDTH_PARAM)).toBeNull();
    expect(next.get("view")).toBe("edit");
  });

  it("leaves params without a width untouched", () => {
    expect(clearDocWidth(new URLSearchParams("view=edit")).toString()).toBe(
      "view=edit",
    );
  });

  it("does not mutate the input", () => {
    const params = new URLSearchParams("width=full");
    clearDocWidth(params);
    expect(params.get(WIDTH_PARAM)).toBe("full");
  });
});
