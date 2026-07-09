// Cloudflare's proxy caps request bodies at 100 MB; the DO stores the Yjs
// state in chunks, so the practical ceiling is CPU, not storage. 20 MB keeps
// generous headroom for Yjs/JSON overhead.
export const MAX_CONTENT_BYTES = 20_000_000; // 20 MB

export function textError(message: string, status: number) {
  return new Response(`error: ${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Read and validate an uploaded text body. Returns the content string,
 * or an error Response when the body is too large or binary.
 */
export async function readUploadBody(request: Request): Promise<string | Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_CONTENT_BYTES) {
    return textError("content too large (max 20MB)", 413);
  }

  const content = await request.text();

  if (content.length > MAX_CONTENT_BYTES) {
    return textError("content too large (max 20MB)", 413);
  }

  if (content.includes("\0")) {
    return textError("file appears to be binary, not text", 400);
  }

  return content;
}
