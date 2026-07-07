import { describe, it, expect } from "vitest";
import { parseViewMode, applyViewMode, VIEW_PARAM } from "~/lib/view-mode";

describe("parseViewMode", () => {
  it("defaults to preview when no param is present", () => {
    expect(parseViewMode(new URLSearchParams())).toBe("preview");
  });

  it("returns edit for ?view=edit", () => {
    expect(parseViewMode(new URLSearchParams("view=edit"))).toBe("edit");
  });

  it("returns preview for explicit ?view=preview", () => {
    expect(parseViewMode(new URLSearchParams("view=preview"))).toBe("preview");
  });

  it("falls back to preview for unknown values", () => {
    expect(parseViewMode(new URLSearchParams("view=banana"))).toBe("preview");
    expect(parseViewMode(new URLSearchParams("view="))).toBe("preview");
    expect(parseViewMode(new URLSearchParams("view=EDIT"))).toBe("preview");
  });

  it("ignores unrelated params", () => {
    expect(parseViewMode(new URLSearchParams("foo=bar"))).toBe("preview");
    expect(parseViewMode(new URLSearchParams("foo=bar&view=edit"))).toBe("edit");
  });
});

describe("applyViewMode", () => {
  it("sets view=edit when switching to edit", () => {
    const next = applyViewMode(new URLSearchParams(), "edit");
    expect(next.get(VIEW_PARAM)).toBe("edit");
  });

  it("removes the param when switching to preview (default is implicit)", () => {
    const next = applyViewMode(new URLSearchParams("view=edit"), "preview");
    expect(next.has(VIEW_PARAM)).toBe(false);
  });

  it("preserves unrelated params", () => {
    const next = applyViewMode(new URLSearchParams("foo=bar&view=edit"), "preview");
    expect(next.get("foo")).toBe("bar");
    const next2 = applyViewMode(new URLSearchParams("foo=bar"), "edit");
    expect(next2.get("foo")).toBe("bar");
    expect(next2.get(VIEW_PARAM)).toBe("edit");
  });

  it("does not mutate the input params", () => {
    const input = new URLSearchParams("view=edit");
    applyViewMode(input, "preview");
    expect(input.get(VIEW_PARAM)).toBe("edit");
  });

  it("round-trips through parseViewMode", () => {
    for (const mode of ["preview", "edit"] as const) {
      expect(parseViewMode(applyViewMode(new URLSearchParams(), mode))).toBe(mode);
    }
  });
});
