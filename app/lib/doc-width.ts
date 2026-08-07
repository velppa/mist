/**
 * Width of the document column: full bleed, or a measure capped in
 * characters. Normally a per-user preference, overridable per link.
 */
export type DocWidth = "full" | "120" | "65";

export const DOC_WIDTHS: DocWidth[] = ["full", "120", "65"];

/** Width used when nothing is stored and no override is given. */
export const DEFAULT_DOC_WIDTH: DocWidth = "120";

/** URL query parameter that overrides the stored width on /docs/:id. */
export const WIDTH_PARAM = "width";

/**
 * Width demanded by the URL, or null when the link leaves the choice to
 * the reader. Unknown values are ignored rather than treated as a width.
 */
export function parseDocWidth(params: URLSearchParams): DocWidth | null {
  const value = params.get(WIDTH_PARAM);
  return value && (DOC_WIDTHS as string[]).includes(value)
    ? (value as DocWidth)
    : null;
}

/**
 * Returns a copy of the params without the width override, so a width the
 * reader picks themselves is not immediately overruled by the link they
 * arrived on.
 */
export function clearDocWidth(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(WIDTH_PARAM);
  return next;
}
