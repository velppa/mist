import { describe, it, expect } from "vitest";
import { Marked } from "marked";
import { slugify, headingAnchors } from "~/lib/heading-anchors";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Sample row-level diffs")).toBe("sample-row-level-diffs");
  });

  it("strips punctuation but keeps underscores and hyphens", () => {
    expect(slugify("What's new? (v2.0)")).toBe("whats-new-v20");
    expect(slugify("property_type")).toBe("property_type");
  });

  it("keeps unicode letters", () => {
    expect(slugify("Überblick")).toBe("überblick");
    expect(slugify("日本語 見出し")).toBe("日本語-見出し");
  });
});

describe("headingAnchors", () => {
  const md = () => new Marked(headingAnchors());

  it("adds GitHub-style ids to headings", () => {
    const html = md().parse("## Crowdin sync", { async: false }) as string;
    expect(html).toContain('<h2 id="crowdin-sync">Crowdin sync ');
  });

  it("appends a permalink anchor pointing at the heading's id", () => {
    const html = md().parse("## Crowdin sync", { async: false }) as string;
    expect(html).toContain(
      '<a class="heading-anchor" href="#crowdin-sync" aria-label="Permalink to this heading">#</a></h2>',
    );
  });

  it("slugs the plain text of a heading with inline markup", () => {
    const html = md().parse("# Hello **world**", { async: false }) as string;
    expect(html).toContain('<h1 id="hello-world">');
    expect(html).toContain("<strong>world</strong>");
  });

  it("suffixes duplicate headings", () => {
    const html = md().parse("# Setup\n\n# Setup", { async: false }) as string;
    expect(html).toContain('<h1 id="setup">');
    expect(html).toContain('<h1 id="setup-1">');
  });

  it("restarts duplicate counting on each document", () => {
    const instance = md();
    instance.parse("# Setup", { async: false });
    const html = instance.parse("# Setup", { async: false }) as string;
    expect(html).toContain('<h1 id="setup">');
    expect(html).not.toContain("setup-1");
  });
});
