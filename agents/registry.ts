import { Agent } from "agents";
import { REGISTRY_LIMIT } from "../app/shared/constants";
import type { RegistryEntry } from "../app/shared/types";

/**
 * Payload accepted by POST /upsert. `author` is optional so that a
 * frontmatter author (today) or an authenticated author (future auth
 * workstream) can both slot into the same field.
 */
interface UpsertPayload {
  id?: unknown;
  title?: unknown;
  author?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * DocumentRegistry is a singleton Durable Object (instance name
 * "registry") that indexes documents for the homepage listing.
 * DocumentAgent pushes an entry here when a document is created and
 * (debounced) when its content changes.
 */
class DocumentRegistry extends Agent {
  private ensureTable() {
    this.sql`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
  }

  async onRequest(request: Request): Promise<Response> {
    this.ensureTable();
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/upsert") {
      let payload: UpsertPayload;
      try {
        payload = (await request.json()) as UpsertPayload;
      } catch {
        return json({ ok: false, error: "invalid JSON" }, 400);
      }

      if (typeof payload.id !== "string" || !payload.id) {
        return json({ ok: false, error: "id is required" }, 400);
      }

      const id = payload.id;
      const title =
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim()
          : id;
      const author =
        typeof payload.author === "string" && payload.author.trim()
          ? payload.author.trim()
          : null;
      const now = Date.now();

      // Keep created_at from the first upsert; keep a previously known
      // author if the new payload doesn't carry one.
      this.sql`
        INSERT INTO documents (id, title, author, created_at, updated_at)
        VALUES (${id}, ${title}, ${author}, ${now}, ${now})
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          author = COALESCE(excluded.author, documents.author),
          updated_at = excluded.updated_at
      `;

      return json({ ok: true });
    }

    // Documents toggled private are withdrawn from the listing.
    if (request.method === "POST" && url.pathname === "/remove") {
      let payload: { id?: unknown };
      try {
        payload = (await request.json()) as { id?: unknown };
      } catch {
        return json({ ok: false, error: "invalid JSON" }, 400);
      }

      if (typeof payload.id !== "string" || !payload.id) {
        return json({ ok: false, error: "id is required" }, 400);
      }

      this.sql`DELETE FROM documents WHERE id = ${payload.id}`;
      return json({ ok: true });
    }

    if (request.method === "GET") {
      const rows = this.sql<{
        id: string;
        title: string;
        author: string | null;
        created_at: number;
        updated_at: number;
      }>`
        SELECT id, title, author, created_at, updated_at
        FROM documents
        ORDER BY updated_at DESC
        LIMIT ${REGISTRY_LIMIT}
      `;

      const documents: RegistryEntry[] = rows.map((row) => ({
        id: row.id,
        title: row.title,
        author: row.author,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      return json({ documents });
    }

    return new Response("Not found", { status: 404 });
  }
}

export default DocumentRegistry;
