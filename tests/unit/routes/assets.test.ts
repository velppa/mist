// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAgentFetch, mockEnv } = vi.hoisted(() => ({
  mockAgentFetch: vi.fn(),
  mockEnv: { AssetStore: {} } as Record<string, unknown>,
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockAgentFetch }),
}));

import { handleAssetUpload, handleAssetGet } from "~/lib/assets.server";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const NAME_PATTERN = /^\/assets\/\d{8}T\d{6}\.\d{6}(--[a-z0-9_-]+)?\.png$/;

function upload(body: BodyInit, headers: Record<string, string>, query = "") {
  return handleAssetUpload(
    new Request(`https://mist.example.com/assets${query}`, {
      method: "POST",
      body,
      headers,
    }),
    mockEnv,
  );
}

describe("POST /assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    delete mockEnv.MIST_API_TOKENS;
    delete mockEnv.ONELOGIN_SUBDOMAIN;
    delete mockEnv.ONELOGIN_CLIENT_ID;
    delete mockEnv.ONELOGIN_CLIENT_SECRET;
    delete mockEnv.SESSION_SECRET;
  });

  it("stores an image and returns its relative URL", async () => {
    const res = await upload(PNG, { "Content-Type": "image/png" }, "?name=Shot.png");
    expect(res.status).toBe(201);
    const url = (await res.text()).trim();
    expect(url).toMatch(NAME_PATTERN);
    expect(url).toContain("--shot.png");

    const stored = mockAgentFetch.mock.calls[0][0] as Request;
    const target = new URL(stored.url);
    expect(target.pathname).toBe("/put");
    expect(target.searchParams.get("type")).toBe("image/png");
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(PNG);
  });

  it("works without a client filename", async () => {
    const res = await upload(PNG, { "Content-Type": "image/png" });
    expect(res.status).toBe(201);
    expect((await res.text()).trim()).toMatch(NAME_PATTERN);
  });

  it("rejects unsupported content types", async () => {
    const res = await upload("hello", { "Content-Type": "text/plain" });
    expect(res.status).toBe(415);
    expect(mockAgentFetch).not.toHaveBeenCalled();

    const bin = await upload(PNG, { "Content-Type": "application/octet-stream" });
    expect(bin.status).toBe(415);
  });

  it("stores JSON with a .json name", async () => {
    const res = await upload('{"a":1}', { "Content-Type": "application/json" }, "?name=run data");
    expect(res.status).toBe(201);
    const url = (await res.text()).trim();
    expect(url).toMatch(/^\/assets\/\d{8}T\d{6}\.\d{6}--run-data\.json$/);

    const stored = mockAgentFetch.mock.calls[0][0] as Request;
    expect(new URL(stored.url).searchParams.get("type")).toBe("application/json");
  });

  it("rejects oversized uploads via content-length", async () => {
    const res = await upload(PNG, {
      "Content-Type": "image/png",
      "content-length": "30000000",
    });
    expect(res.status).toBe(413);
  });

  it("rejects an empty body", async () => {
    const res = await upload(new Uint8Array(0), { "Content-Type": "image/png" });
    expect(res.status).toBe(400);
  });

  it("requires auth when tokens are configured", async () => {
    mockEnv.MIST_API_TOKENS = '{"s3cret":"alice@vio.com"}';
    const res = await upload(PNG, { "Content-Type": "image/png" });
    expect(res.status).toBe(401);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("records the token owner as author", async () => {
    mockEnv.MIST_API_TOKENS = '{"s3cret":"alice@vio.com"}';
    const res = await upload(PNG, {
      "Content-Type": "image/png",
      Authorization: "Bearer s3cret",
    });
    expect(res.status).toBe(201);
    const stored = mockAgentFetch.mock.calls[0][0] as Request;
    expect(new URL(stored.url).searchParams.get("author")).toBe("alice@vio.com");
  });
});

describe("GET /assets/:name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function get(name: string) {
    return handleAssetGet(
      new Request(`https://mist.example.com/assets/${name}`),
      mockEnv,
    );
  }

  it("serves stored bytes with cache and nosniff headers", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response(PNG, { headers: { "Content-Type": "image/png" } }),
    );
    const res = await get("20260709T151321.226433--shot.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("sandboxes svg", async () => {
    mockAgentFetch.mockResolvedValue(
      new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }),
    );
    const res = await get("20260709T151321.226433.svg");
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
  });

  it("404s for names outside the generator format", async () => {
    const res = await get("etc-passwd");
    expect(res.status).toBe(404);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("404s when the store misses", async () => {
    mockAgentFetch.mockResolvedValue(new Response("not found", { status: 404 }));
    const res = await get("20260709T151321.226433.png");
    expect(res.status).toBe(404);
  });
});
