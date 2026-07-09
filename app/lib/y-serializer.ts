import * as Y from "yjs";
import { DELIMITERS } from "./critic-constants";

type MarkKind = keyof typeof DELIMITERS;

/**
 * Which CriticMarkup mark (if any) a delta run carries. y-tiptap stores
 * repeatable marks under suffixed keys ("criticComment--<id>"), so the
 * match is by prefix. Precedence mirrors the editor serializer.
 */
function markKind(attributes: Record<string, unknown> | undefined): MarkKind | null {
  if (!attributes) return null;
  const keys = Object.keys(attributes);
  const has = (name: string) =>
    keys.some((k) => k === name || k.startsWith(`${name}--`));
  if (has("criticAddition")) return "addition";
  if (has("criticDeletion")) return "deletion";
  if (has("criticComment")) return "comment";
  if (has("criticHighlight")) return "highlight";
  return null;
}

function textWithMarkup(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) {
    return (node.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>)
      .map((op) => {
        if (typeof op.insert !== "string") return "";
        const kind = markKind(op.attributes);
        if (!kind) return op.insert;
        const { open, close } = DELIMITERS[kind];
        return `${open}${op.insert}${close}`;
      })
      .join("");
  }
  if (node instanceof Y.XmlElement) {
    return node.toArray().map(textWithMarkup).join("");
  }
  return "";
}

/**
 * Serialize the Yjs document to text with CriticMarkup delimiters,
 * without requiring a mounted editor. Semantics mirror
 * serializeWithCriticMarkup (the ProseMirror-based serializer used
 * while editing): one line per top-level block, marks re-emitted as
 * {++ ++} / {-- --} / {>> <<} / {== ==}.
 */
export function serializeYDocWithCriticMarkup(doc: Y.Doc): string {
  const frag = doc.getXmlFragment("default");
  return frag.toArray().map(textWithMarkup).join("\n");
}
