/** Only names our own generator produces are ever served. */
export const ASSET_NAME_PATTERN = /^\d{8}T\d{6}\.\d{6}(--[a-z0-9_-]+)?\.[a-z0-9]+$/;

/**
 * Kebab-case a client-supplied filename into the optional `--{name}`
 * suffix. The extension is dropped (the stored one comes from the
 * Content-Type) and the result is capped so names stay readable.
 */
export function sanitizeAssetLabel(raw: string): string {
  const base = raw.replace(/\.[A-Za-z0-9]+$/, "");
  return base
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/^-|-$/g, "");
}

/** UTC timestamp name: YYYYMMDDTHHMMSS.ffffff (ms padded to microseconds). */
export function generateAssetName(label: string, extension: string, now = new Date()): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}` +
    `.${pad(now.getUTCMilliseconds() * 1000, 6)}`;
  const suffix = label ? `--${label}` : "";
  return `${stamp}${suffix}.${extension}`;
}
