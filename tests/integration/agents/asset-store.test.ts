import { describe, it, expect, vi, beforeEach } from "vitest";

interface AssetRow {
  content_type: string;
  size: number;
  created_at: number;
  author: string | null;
}

let mockAssets: Map<string, AssetRow>;
let mockChunks: Map<string, ArrayBuffer>;

vi.mock("agents", () => ({
  Agent: class MockAgent {
    name = "assets";
    env = {};

    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("?").toLowerCase().replace(/\s+/g, " ").trim();

      if (query.includes("create table")) return [];

      if (query.includes("insert into assets")) {
        const [name, contentType, size, createdAt, author] = values as [
          string,
          string,
          number,
          number,
          string | null,
        ];
        mockAssets.set(name, {
          content_type: contentType,
          size,
          created_at: createdAt,
          author,
        });
        return [];
      }

      if (query.includes("insert into asset_chunks")) {
        const [name, idx, blob] = values as [string, number, Uint8Array];
        mockChunks.set(
          `${name}:${idx}`,
          blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
        );
        return [];
      }

      if (query.includes("delete from asset_chunks")) {
        const [name, minIdx] = values as [string, number];
        for (const key of [...mockChunks.keys()]) {
          const [n, idx] = [key.slice(0, key.lastIndexOf(":")), Number(key.slice(key.lastIndexOf(":") + 1))];
          if (n === name && idx >= minIdx) mockChunks.delete(key);
        }
        return [];
      }

      if (query.includes("select content_type, size from assets")) {
        const name = values[0] as string;
        const row = mockAssets.get(name);
        return row ? [{ content_type: row.content_type, size: row.size }] : [];
      }

      if (query.includes("select idx, value from asset_chunks")) {
        const name = values[0] as string;
        return [...mockChunks.entries()]
          .filter(([key]) => key.slice(0, key.lastIndexOf(":")) === name)
          .map(([key, value]) => ({
            idx: Number(key.slice(key.lastIndexOf(":") + 1)),
            value,
          }));
      }

      return [];
    }
  },
}));

import AssetStore from "../../../agents/assets";

describe("AssetStore", () => {
  let store: InstanceType<typeof AssetStore>;

  beforeEach(() => {
    mockAssets = new Map();
    mockChunks = new Map();
    store = new AssetStore({} as never, {} as never);
  });

  function put(name: string, bytes: Uint8Array, type = "image/png", author?: string) {
    const url = new URL("https://assets/put");
    url.searchParams.set("name", name);
    url.searchParams.set("type", type);
    if (author) url.searchParams.set("author", author);
    return store.onRequest(new Request(url, { method: "POST", body: bytes }));
  }

  function get(name: string) {
    const url = new URL("https://assets/get");
    url.searchParams.set("name", name);
    return store.onRequest(new Request(url));
  }

  it("roundtrips a small asset with its content type", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const putRes = await put("a.png", bytes, "image/png", "pavel@vio.com");
    expect(putRes.status).toBe(201);

    const res = await get("a.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(mockAssets.get("a.png")?.author).toBe("pavel@vio.com");
  });

  it("chunks large assets and reassembles them byte-identically", async () => {
    const bytes = new Uint8Array(3_200_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    await put("big.png", bytes);

    const chunkKeys = [...mockChunks.keys()].filter((k) => k.startsWith("big.png:"));
    expect(chunkKeys.length).toBeGreaterThan(1);

    const res = await get("big.png");
    const out = new Uint8Array(await res.arrayBuffer());
    expect(out.length).toBe(bytes.length);
    expect(out).toEqual(bytes);
  });

  it("overwriting with a smaller asset drops stale chunks", async () => {
    await put("x.png", new Uint8Array(3_200_000));
    await put("x.png", new Uint8Array([9, 9]));

    const chunkKeys = [...mockChunks.keys()].filter((k) => k.startsWith("x.png:"));
    expect(chunkKeys).toEqual(["x.png:0"]);
    const res = await get("x.png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
  });

  it("404s for unknown assets and paths", async () => {
    expect((await get("missing.png")).status).toBe(404);
    expect(
      (await store.onRequest(new Request("https://assets/other"))).status,
    ).toBe(404);
  });
});
