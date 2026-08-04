import { Agent } from "agents";
import { REGISTRY_LIMIT } from "../app/shared/constants";
import type { RegistryEntry } from "../app/shared/types";

/**
 * Payload accepted by POST /upsert. `author` is optional so that a
 * frontmatter author or an authenticated author can both slot into the
 * same field. `listed` controls whether the document appears in the
 * homepage listing; unlisted documents stay in the registry so their
 * owner can find them under "My docs".
 */
interface UpsertPayload {
  id?: unknown;
  title?: unknown;
  author?: unknown;
  listed?: unknown;
  format?: unknown;
  bumpUpdated?: boolean;
}

/**
 * Documents created before author recording existed have no author.
 * The instance owner asked for them to be adopted under his email so
 * they show up in "My docs"; applied once, with the schema migration.
 */
const LEGACY_AUTHOR = "pavel@vio.com";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Row {
  id: string;
  title: string;
  author: string | null;
  listed: number;
  format: string;
  created_at: number;
  updated_at: number;
}

function toEntry(row: Row): RegistryEntry {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    listed: row.listed === 1,
    format: row.format,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * DocumentRegistry is a singleton Durable Object (instance name
 * "registry") that indexes documents. DocumentAgent pushes an entry
 * here when a document is created and (debounced) when its content
 * changes. The homepage lists listed entries; /by-author powers the
 * per-user "My docs" view.
 */
class DocumentRegistry extends Agent {
  private ensureTable() {
    this.sql`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT,
        listed INTEGER NOT NULL DEFAULT 0,
        format TEXT NOT NULL DEFAULT 'md',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    this.migrate();
  }

  /**
   * Live databases arrive here in one of three shapes: fresh (created
   * above, already has `listed`), first-generation (no visibility
   * column at all), or second-generation (the column was still called
   * `public`). Column presence decides which one-shot step applies.
   */
  private migrate() {
    const cols = this.sql<{ name: string }>`
      SELECT name FROM pragma_table_info('documents')
    `.map((row) => row.name);

    if (!cols.includes("listed") && !cols.includes("public")) {
      // v1: no visibility column. Rows predating it were all listed by
      // construction, and authorless rows are adopted by the instance
      // owner (his explicit request) so they show in "My docs".
      this.sql`ALTER TABLE documents ADD COLUMN listed INTEGER NOT NULL DEFAULT 0`;
      this.sql`UPDATE documents SET listed = 1`;
      this.sql`UPDATE documents SET author = ${LEGACY_AUTHOR} WHERE author IS NULL`;
    } else if (cols.includes("public")) {
      // v2: the concept was renamed public -> listed.
      this.sql`ALTER TABLE documents RENAME COLUMN public TO listed`;
    }

    if (!cols.includes("format")) {
      // v3: format became registry metadata (defaulting to markdown).
      this.sql`ALTER TABLE documents ADD COLUMN format TEXT NOT NULL DEFAULT 'md'`;
    }
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
      const listed = payload.listed === true ? 1 : 0;
      const format =
        typeof payload.format === "string" && payload.format ? payload.format : "md";
      // Metadata flips (listed/format) must not reorder listings, so
      // they leave updated_at alone; content edits bump it.
      const bump = payload.bumpUpdated !== false ? 1 : 0;
      const now = Date.now();

      // Keep created_at from the first upsert; keep a previously known
      // author if the new payload doesn't carry one.
      this.sql`
        INSERT INTO documents (id, title, author, listed, format, created_at, updated_at)
        VALUES (${id}, ${title}, ${author}, ${listed}, ${format}, ${now}, ${now})
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          author = COALESCE(excluded.author, documents.author),
          listed = excluded.listed,
          format = excluded.format,
          updated_at = CASE WHEN ${bump} = 1 THEN excluded.updated_at ELSE documents.updated_at END
      `;

      return json({ ok: true });
    }

    // Deleted documents are withdrawn entirely.
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

    // All documents (listed and unlisted) belonging to one author.
    if (request.method === "POST" && url.pathname === "/by-author") {
      let payload: { email?: unknown };
      try {
        payload = (await request.json()) as { email?: unknown };
      } catch {
        return json({ ok: false, error: "invalid JSON" }, 400);
      }

      if (typeof payload.email !== "string" || !payload.email) {
        return json({ ok: false, error: "email is required" }, 400);
      }

      const rows = this.sql<Row>`
        SELECT id, title, author, listed, format, created_at, updated_at
        FROM documents
        WHERE author = ${payload.email}
        ORDER BY updated_at DESC
      `;

      return json({ documents: rows.map(toEntry) });
    }

    // Every document in the registry, listed or not — the "my documents"
    // view of a single-user (auth-off) instance, where ownership cannot
    // be attributed and everything belongs to the operator.
    if (request.method === "POST" && url.pathname === "/all") {
      const rows = this.sql<Row>`
        SELECT id, title, author, listed, format, created_at, updated_at
        FROM documents
        ORDER BY updated_at DESC
      `;
      return json({ documents: rows.map(toEntry) });
    }

    if (request.method === "GET") {
      const rows = this.sql<Row>`
        SELECT id, title, author, listed, format, created_at, updated_at
        FROM documents
        WHERE listed = 1
        ORDER BY updated_at DESC
        LIMIT ${REGISTRY_LIMIT}
      `;

      return json({ documents: rows.map(toEntry) });
    }

    return new Response("Not found", { status: 404 });
  }
}

export default DocumentRegistry;
