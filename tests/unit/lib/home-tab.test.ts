import { describe, it, expect } from "vitest";
import { parseHomeTab } from "~/lib/home-tab";

describe("parseHomeTab", () => {
  it("defaults to my documents", () => {
    expect(parseHomeTab(null)).toBe("my");
    expect(parseHomeTab("")).toBe("my");
    expect(parseHomeTab("bogus")).toBe("my");
  });

  it("keeps old ?tab=my links on my documents", () => {
    expect(parseHomeTab("my")).toBe("my");
  });

  it("selects listed documents explicitly", () => {
    expect(parseHomeTab("listed")).toBe("listed");
  });
});
