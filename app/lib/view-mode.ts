/**
 * View mode of the document page: rendered read-only preview vs the
 * live collaborative editor. Kept separate from `DocMode` (edit/suggest),
 * which governs how edits are applied, not whether the editing UI shows.
 */
export type ViewMode = "preview" | "edit";

/** URL query parameter that selects the view mode on /docs/:id. */
export const VIEW_PARAM = "view";

/**
 * Documents open read-only by default; editing is opt-in via ?view=edit.
 * Unknown values fall back to the safe default (preview).
 */
export function parseViewMode(params: URLSearchParams): ViewMode {
  return params.get(VIEW_PARAM) === "edit" ? "edit" : "preview";
}

/**
 * Returns a copy of the params with the view mode applied. Preview is the
 * default, so it is encoded by omitting the param — shared URLs stay clean.
 */
export function applyViewMode(
  params: URLSearchParams,
  mode: ViewMode,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (mode === "edit") {
    next.set(VIEW_PARAM, "edit");
  } else {
    next.delete(VIEW_PARAM);
  }
  return next;
}
