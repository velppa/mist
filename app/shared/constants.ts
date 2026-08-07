export const APP_NAME = "mist";
// Bumped on request; the footer links this to the changelog document
export const APP_VERSION = "0.9.0";

/** Document formats. Stored in the shared docState map, not the id. */
export type DocFormat = "md" | "txt" | "html" | "jsx" | "ipynb";

export const DOC_FORMATS: DocFormat[] = ["md", "txt", "html", "jsx", "ipynb"];

/**
 * The format a document effectively has: the stored docState value when
 * it is a known format, markdown otherwise.
 */
export function effectiveFormat(stored?: string | null): DocFormat {
  return (DOC_FORMATS as string[]).includes(stored ?? "")
    ? (stored as DocFormat)
    : "md";
}

/** Bare 8-char document id (no alias, no extension). */
export function isValidDocumentId(id: string): boolean {
  return /^[a-z0-9]{8}$/.test(id);
}

/**
 * Canonical id of a /docs or /raw path parameter. The parameter may
 * carry a decorative title alias and a decorative format extension
 * ("sapi-override-generator-4q5dalwz.html"); the trailing 8-char
 * segment is authoritative. Returns null when no valid id can be
 * extracted.
 */
export function parseDocId(param: string): string | null {
  const base = param.replace(/\.(md|txt|html|jsx|ipynb)$/, "");
  if (isValidDocumentId(base)) return base;
  const match = base.match(/-([a-z0-9]{8})$/);
  if (match) return match[1];
  return null;
}

/** Kebab-case slug of a title, empty when nothing usable survives. */
export function docSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
}

/**
 * Path to a document, with a title-derived alias when the title
 * yields one and an explicit format extension for every format:
 * "/docs/<slug>-<id>.<format>".
 */
export function docAliasPath(
  id: string,
  title?: string | null,
  format?: DocFormat,
): string {
  return `/docs/${docAliasId(id, title, format)}`;
}

/**
 * Id decorated with the title-derived alias and the format extension
 * ("<slug>-<id>.<format>"). The alias and extension are decorative;
 * only the 8-char id resolves the document.
 */
export function docAliasId(
  id: string,
  title?: string | null,
  format?: DocFormat,
): string {
  const slug = title ? docSlug(title) : "";
  const ext = format ? `.${format}` : "";
  // A slug that is just the id (or empty) adds nothing
  if (!slug || slug === id) {
    return `${id}${ext}`;
  }
  return `${slug}-${id}${ext}`;
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 8;

export function generateDocumentId(): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return id;
}

export const USER_COLOURS = [
  { color: "#E57373", light: "#FFCDD2" },
  { color: "#81C784", light: "#C8E6C9" },
  { color: "#64B5F6", light: "#BBDEFB" },
  { color: "#FFB74D", light: "#FFE0B2" },
  { color: "#BA68C8", light: "#E1BEE7" },
  { color: "#4DD0E1", light: "#B2EBF2" },
  { color: "#FF8A65", light: "#FFCCBC" },
  { color: "#AED581", light: "#DCEDC8" },
] as const;

/**
 * Yjs document format version. Bump when the shared type schema changes
 * (e.g. switching CriticMarkup from plain text to ProseMirror marks).
 *
 * v1: plain text with CriticMarkup delimiters, threads in Y.Map("threads")
 * v2: CriticMarkup stored as ProseMirror marks, threads in Y.Map("threads")
 */
export const DOC_FORMAT_VERSION = 2;

/** Name of the singleton DocumentRegistry Durable Object instance */
export const REGISTRY_AGENT_NAME = "registry";
/** Maximum number of documents listed on the homepage */
export const REGISTRY_LIMIT = 100;

/** Protocol message type: Yjs sync */
export const MSG_SYNC = 0;
/** Protocol message type: Yjs awareness */
export const MSG_AWARENESS = 1;

/** Name of the singleton TokenStore Durable Object instance */
export const TOKEN_STORE_AGENT_NAME = "tokens";
export const ASSET_STORE_AGENT_NAME = "assets";
