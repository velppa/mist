/** Key in the shared Yjs docState map carrying the listing opt-in. */
export const LISTED_KEY = "listed";

/** Key in the shared Yjs docState map carrying the document format. */
export const FORMAT_KEY = "format";

/** The concept was called "public" before the rename. */
const LEGACY_LISTED_KEY = "public";

export function readListedFlag(docState: {
  get(key: string): string | undefined;
}): boolean {
  return docState.get(LISTED_KEY) === "true";
}

/**
 * Documents created before the rename carry the legacy key. The server
 * migrates the map in place when it initialises a document, so clients
 * only ever read the new key. Callers wrap this in a Yjs transaction
 * and persist the document when it reports a migration happened.
 */
export function migrateLegacyListedKey(docState: {
  get(key: string): string | undefined;
  set(key: string, value: string): unknown;
  delete(key: string): void;
}): boolean {
  const legacy = docState.get(LEGACY_LISTED_KEY);
  if (legacy === undefined) return false;
  if (docState.get(LISTED_KEY) === undefined) {
    docState.set(LISTED_KEY, legacy);
  }
  docState.delete(LEGACY_LISTED_KEY);
  return true;
}
