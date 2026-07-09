export const APP_NAME = "mist";

/** Document formats, encoded as an id suffix; markdown has none. */
export type DocFormat = "md" | "txt" | "html" | "jsx";

/** Format of a document, derived from its id suffix. */
export function docFormat(id: string): DocFormat {
  if (id.endsWith(".txt")) return "txt";
  if (id.endsWith(".html")) return "html";
  if (id.endsWith(".jsx")) return "jsx";
  return "md";
}

export function isValidDocumentId(id: string): boolean {
  const base = id.replace(/\.(txt|html|jsx)$/, "");
  if (base.length !== 8) return false;
  return /^[a-z0-9]+$/.test(base);
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
