export type HomeTab = "listed" | "my";

/** The homepage tab a `?tab=` value selects; "My documents" by default. */
export function parseHomeTab(value: string | null): HomeTab {
  return value === "listed" ? "listed" : "my";
}
