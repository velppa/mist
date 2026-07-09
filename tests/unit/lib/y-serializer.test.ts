import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { serializeYDocWithCriticMarkup } from "~/lib/y-serializer";

function docWith(build: (frag: Y.XmlFragment) => void): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  doc.transact(() => build(frag));
  return doc;
}

function para(...runs: Array<[string, Record<string, unknown>?]>): Y.XmlElement {
  const el = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  el.insert(0, [text]);
  let offset = 0;
  for (const [content, attrs] of runs) {
    text.insert(offset, content, attrs ?? {});
    offset += content.length;
  }
  return el;
}

describe("serializeYDocWithCriticMarkup", () => {
  it("serializes plain paragraphs joined by newlines", () => {
    const doc = docWith((f) => f.insert(0, [para(["one"]), para(["two"])]));
    expect(serializeYDocWithCriticMarkup(doc)).toBe("one\ntwo");
  });

  it("emits addition and deletion delimiters", () => {
    const doc = docWith((f) =>
      f.insert(0, [
        para(["keep "], ["new", { criticAddition: {} }], [" and "], ["old", { criticDeletion: {} }]),
      ]),
    );
    expect(serializeYDocWithCriticMarkup(doc)).toBe(
      "keep {++new++} and {--old--}",
    );
  });

  it("emits highlight and comment delimiters", () => {
    const doc = docWith((f) =>
      f.insert(0, [
        para(["a "], ["term", { criticHighlight: {} }], ["note", { criticComment: {} }]),
      ]),
    );
    expect(serializeYDocWithCriticMarkup(doc)).toBe("a {==term==}{>>note<<}");
  });

  it("recognises y-tiptap suffixed mark keys", () => {
    const doc = docWith((f) =>
      f.insert(0, [
        para(
          ["x", { "criticAddition--abc12345": {} }],
          ["y", { "criticComment--OgPvVwWr": {} }],
        ),
      ]),
    );
    expect(serializeYDocWithCriticMarkup(doc)).toBe("{++x++}{>>y<<}");
  });

  it("keeps empty paragraphs as blank lines", () => {
    const doc = docWith((f) =>
      f.insert(0, [para(["top"]), new Y.XmlElement("paragraph"), para(["bottom"])]),
    );
    expect(serializeYDocWithCriticMarkup(doc)).toBe("top\n\nbottom");
  });
});
