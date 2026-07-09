export const APP_NAME = "mist";

/** Document formats, encoded as an id suffix; markdown has none. */
export type DocFormat = "md" | "txt" | "html" | "jsx" | "ipynb";

/** Format of a document, derived from its id suffix. */
export function docFormat(id: string): DocFormat {
  if (id.endsWith(".txt")) return "txt";
  if (id.endsWith(".html")) return "html";
  if (id.endsWith(".jsx")) return "jsx";
  if (id.endsWith(".ipynb")) return "ipynb";
  return "md";
}

export function isValidDocumentId(id: string): boolean {
  const base = id.replace(/\.(txt|html|jsx|ipynb)$/, "");
  if (base.length !== 8) return false;
  return /^[a-z0-9]+$/.test(base);
}

/**
 * Canonical id of a /docs or /raw path parameter. The parameter may
 * carry a decorative title alias ("sapi-override-generator-4q5dalwz.html");
 * the trailing 8-char segment is authoritative. Returns null when no
 * valid id can be extracted.
 */
export function parseDocId(param: string): string | null {
  if (isValidDocumentId(param)) return param;
  const match = param.match(/-([a-z0-9]{8}(?:\.(?:txt|html|jsx|ipynb))?)$/);
  if (match && isValidDocumentId(match[1])) return match[1];
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
 * yields one ("/docs/<slug>-<id>", else "/docs/<id>").
 */
export function docAliasPath(id: string, title?: string | null): string {
  return `/docs/${docAliasId(id, title)}`;
}

/**
 * Id decorated with the title-derived alias ("<slug>-<id>"), or the
 * plain id when the title yields no useful slug.
 */
export function docAliasId(id: string, title?: string | null): string {
  const slug = title ? docSlug(title) : "";
  // A slug that is just the id (or empty) adds nothing
  if (!slug || slug === id.replace(/\.(txt|html|jsx|ipynb)$/, "")) {
    return id;
  }
  return `${slug}-${id}`;
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
