import { describe, it, expect } from "vitest";
import { sanitizeAssetLabel, generateAssetName } from "~/shared/asset-name";

const NAME_PATTERN = /^\d{8}T\d{6}\.\d{6}(--[a-z0-9_-]+)?\.[a-z0-9]+$/;

describe("sanitizeAssetLabel", () => {
  it("kebab-cases and drops the extension", () => {
    expect(sanitizeAssetLabel("Screen Shot 2026.png")).toBe("screen-shot-2026");
  });

  it("strips accents and odd characters", () => {
    expect(sanitizeAssetLabel("Éxposé (final)!.jpeg")).toBe("expose-final");
  });

  it("keeps underscores and dashes", () => {
    expect(sanitizeAssetLabel("my_chart-v2.webp")).toBe("my_chart-v2");
  });

  it("caps length and trims dangling dashes", () => {
    const label = sanitizeAssetLabel("a".repeat(60) + "-tail.png");
    expect(label.length).toBeLessThanOrEqual(40);
    expect(label.endsWith("-")).toBe(false);
  });

  it("returns empty for garbage", () => {
    expect(sanitizeAssetLabel("§§§.png")).toBe("");
  });
});

describe("generateAssetName", () => {
  it("matches the documented format with a label", () => {
    const name = generateAssetName("shot", "png", new Date(Date.UTC(2026, 6, 9, 15, 13, 21, 226)));
    expect(name).toBe("20260709T151321.226000--shot.png");
    expect(name).toMatch(NAME_PATTERN);
  });

  it("omits the label suffix when empty", () => {
    const name = generateAssetName("", "jpg", new Date(Date.UTC(2026, 0, 1)));
    expect(name).toBe("20260101T000000.000000.jpg");
    expect(name).toMatch(NAME_PATTERN);
  });
});
