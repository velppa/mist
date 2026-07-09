import { Agent } from "agents";

/**
 * Durable Objects SQLite accepts Uint8Array for BLOB columns via the
 * template literal API, but the type signature expects string. This
 * helper makes the cast explicit and grep-able.
 */
function sqlBlob(data: Uint8Array): string {
  return data as unknown as string;
}

export interface AssetMeta {
  name: string;
  contentType: string;
  size: number;
  createdAt: number;
  author: string | null;
}

/**
 * AssetStore is a singleton Durable Object (instance name "assets")
 * holding uploaded images. Bytes are stored in fixed-size chunk rows
 * because a single SQLite value caps at 2 MB. It is only ever called
 * server-side through the /assets routes — the worker entry rejects
 * /agents/asset-store/* so naming and validation stay in one place.
 */
class AssetStore extends Agent {
  private static readonly CHUNK_BYTES = 1_500_000;

  private ensureTables() {
    this.sql`
      CREATE TABLE IF NOT EXISTS assets (
        name TEXT PRIMARY KEY,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        author TEXT
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS asset_chunks (
        name TEXT NOT NULL,
        idx INTEGER NOT NULL,
        value BLOB NOT NULL,
        PRIMARY KEY (name, idx)
      )
    `;
  }

  async onRequest(request: Request): Promise<Response> {
    this.ensureTables();
    const url = new URL(request.url);
    const name = url.searchParams.get("name") ?? "";

    if (request.method === "POST" && url.pathname === "/put") {
      if (!name) return new Response("missing name", { status: 400 });
      const contentType = url.searchParams.get("type") ?? "application/octet-stream";
      const author = url.searchParams.get("author");
      const bytes = new Uint8Array(await request.arrayBuffer());

      this.sql`
        INSERT INTO assets (name, content_type, size, created_at, author)
        VALUES (${name}, ${contentType}, ${bytes.length}, ${Date.now()}, ${author})
        ON CONFLICT(name) DO UPDATE SET
          content_type = excluded.content_type,
          size = excluded.size,
          author = excluded.author
      `;
      const chunkCount = Math.max(1, Math.ceil(bytes.length / AssetStore.CHUNK_BYTES));
      for (let i = 0; i < chunkCount; i++) {
        const chunk = bytes.subarray(
          i * AssetStore.CHUNK_BYTES,
          (i + 1) * AssetStore.CHUNK_BYTES,
        );
        this.sql`
          INSERT INTO asset_chunks (name, idx, value) VALUES (${name}, ${i}, ${sqlBlob(chunk)})
          ON CONFLICT(name, idx) DO UPDATE SET value = excluded.value
        `;
      }
      this.sql`DELETE FROM asset_chunks WHERE name = ${name} AND idx >= ${chunkCount}`;

      return new Response(JSON.stringify({ ok: true, name }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && url.pathname === "/get") {
      const meta = this.sql<{
        content_type: string;
        size: number;
      }>`
        SELECT content_type, size FROM assets WHERE name = ${name}
      `;
      if (meta.length === 0) {
        return new Response("not found", { status: 404 });
      }
      const chunks = this.sql<{ idx: number; value: ArrayBuffer }>`
        SELECT idx, value FROM asset_chunks WHERE name = ${name}
      `;
      chunks.sort((a, b) => a.idx - b.idx);
      const bytes = new Uint8Array(meta[0].size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(new Uint8Array(chunk.value), offset);
        offset += chunk.value.byteLength;
      }
      return new Response(bytes, {
        headers: { "Content-Type": meta[0].content_type },
      });
    }

    return new Response("not found", { status: 404 });
  }
}

export default AssetStore;
