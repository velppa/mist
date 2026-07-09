import { getAgentByName } from "agents";
import { ASSET_STORE_AGENT_NAME } from "~/shared/constants";
import {
  ASSET_NAME_PATTERN,
  generateAssetName,
  sanitizeAssetLabel,
} from "~/shared/asset-name";
import { authenticateNewRequest, type AuthEnv } from "~/lib/auth.server";
import { MAX_CONTENT_BYTES, textError } from "~/lib/upload.server";

interface AssetEnv extends AuthEnv {
  AssetStore: Parameters<typeof getAgentByName>[0];
}

/** Image content types accepted by POST /assets and their extensions. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/**
 * POST /assets — store an image, return its relative URL as plain text:
 *   curl -X POST -H "Content-Type: image/png" --data-binary @shot.png \
 *     '<host>/assets?name=shot.png'
 * Auth matches /new (bearer token, session, or open when unconfigured).
 */
export async function handleAssetUpload(request: Request, env: unknown): Promise<Response> {
  try {
    const assetEnv = env as AssetEnv;
    const auth = await authenticateNewRequest(request, assetEnv);
    if (!auth.ok) {
      return textError(auth.message, 401);
    }

    const contentType = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
    const extension = IMAGE_EXTENSIONS[contentType];
    if (!extension) {
      return textError(
        `unsupported image type "${contentType}" (use ${Object.keys(IMAGE_EXTENSIONS).join(", ")})`,
        415,
      );
    }

    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_CONTENT_BYTES) {
      return textError("content too large (max 20MB)", 413);
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_CONTENT_BYTES) {
      return textError("content too large (max 20MB)", 413);
    }
    if (bytes.length === 0) {
      return textError("empty body", 400);
    }

    const url = new URL(request.url);
    const label = sanitizeAssetLabel(url.searchParams.get("name") ?? "");
    const name = generateAssetName(label, extension);

    const store = await getAgentByName(assetEnv.AssetStore, ASSET_STORE_AGENT_NAME);
    const target = new URL("https://assets/put");
    target.searchParams.set("name", name);
    target.searchParams.set("type", contentType);
    if (auth.email) target.searchParams.set("author", auth.email);
    const res = await store.fetch(
      new Request(target, { method: "POST", body: bytes }),
    );
    if (!res.ok) {
      return textError("failed to store asset", 500);
    }

    return new Response(`/assets/${name}\n`, {
      status: 201,
      headers: { "Content-Type": "text/plain" },
    });
  } catch {
    return textError("something went wrong", 500);
  }
}

/**
 * GET /assets/:name — serve the stored image. Deliberately ungated:
 * rendered pages and sandboxed iframes load images from an opaque
 * origin without cookies, so an SSO gate here would break every
 * embedded image. Asset names are unguessable timestamps, matching
 * the know-the-URL access model documents already use.
 */
export async function handleAssetGet(request: Request, env: unknown): Promise<Response> {
  const assetEnv = env as AssetEnv;
  const name = decodeURIComponent(new URL(request.url).pathname.slice("/assets/".length));
  if (!ASSET_NAME_PATTERN.test(name)) {
    return textError("asset not found", 404);
  }

  const store = await getAgentByName(assetEnv.AssetStore, ASSET_STORE_AGENT_NAME);
  const target = new URL("https://assets/get");
  target.searchParams.set("name", name);
  const res = await store.fetch(new Request(target));
  if (!res.ok) {
    return textError("asset not found", 404);
  }

  const contentType = res.headers.get("Content-Type") ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  // SVG can carry scripts; the sandbox keeps them inert when the asset
  // is opened directly on the app origin.
  if (contentType === "image/svg+xml") {
    headers["Content-Security-Policy"] = "sandbox";
  }
  return new Response(res.body, { headers });
}
