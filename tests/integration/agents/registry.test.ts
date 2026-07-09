/**
 * DocumentRegistry integration tests.
 *
 * Tests the registry agent's HTTP interface with a mocked Agent base
 * class (the agents SDK uses cloudflare: protocol imports). The SQL
 * mock emulates the small subset of SQLite the registry uses: an
 * upsert keyed by id, filtered/ordered SELECTs, and the schema
 * migrations (column detection via pragma, ALTERs + backfills).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { REGISTRY_LIMIT } from "~/shared/constants";
import type { RegistryEntry } from "~/shared/types";

interface Row {
  id: string;
  title: string;
  author: string | null;
  listed: number;
  format?: string;
  created_at: number;
  updated_at: number;
}

let mockRows: Map<string, Row>;
// Emulates the visibility column's shape across schema generations
let mockVisibilityColumn: "none" | "public" | "listed";
let mockHasFormatColumn: boolean;

vi.mock("agents", () => ({
  Agent: class MockAgent {
    name = "registry";
    env = {};

    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("?").toLowerCase().replace(/\s+/g, " ").trim();

      if (query.includes("create table")) return [];

      if (query.includes("pragma_table_info")) {
        const names = ["id", "title", "author", "created_at", "updated_at"];
        if (mockVisibilityColumn !== "none") names.push(mockVisibilityColumn);
        if (mockHasFormatColumn) names.push("format");
        return names.map((name) => ({ name }));
      }

      if (query.includes("add column format")) {
        if (mockHasFormatColumn) {
          throw new Error("duplicate column name: format");
        }
        mockHasFormatColumn = true;
        for (const row of mockRows.values()) {
          if (row.format === undefined) row.format = "md";
        }
        return [];
      }

      if (query.includes("add column listed")) {
        if (mockVisibilityColumn !== "none") {
          throw new Error(`duplicate column name: ${mockVisibilityColumn}`);
        }
        mockVisibilityColumn = "listed";
        return [];
      }

      if (query.includes("rename column public to listed")) {
        if (mockVisibilityColumn !== "public") {
          throw new Error("no such column: public");
        }
        mockVisibilityColumn = "listed";
        return [];
      }

      if (query.includes("update documents set listed = 1")) {
        for (const row of mockRows.values()) row.listed = 1;
        return [];
      }

      if (query.includes("update documents set author")) {
        const email = values[0] as string;
        for (const row of mockRows.values()) {
          if (row.author === null) row.author = email;
        }
        return [];
      }

      if (query.includes("insert into documents")) {
        const [id, title, author, listed, format, createdAt, updatedAt, bump] =
          values as [string, string, string | null, number, string, number, number, number];
        const existing = mockRows.get(id);
        if (existing) {
          // Emulates ON CONFLICT: keep created_at, COALESCE author,
          // CASE on bump for updated_at
          mockRows.set(id, {
            ...existing,
            title,
            author: author ?? existing.author,
            listed,
            format,
            updated_at: bump === 0 ? existing.updated_at : updatedAt,
          });
        } else {
          mockRows.set(id, {
            id,
            title,
            author,
            listed,
            format,
            created_at: createdAt,
            updated_at: updatedAt,
          });
        }
        return [];
      }

      if (query.includes("delete from documents")) {
        mockRows.delete(values[0] as string);
        return [];
      }

      if (query.includes("where author =")) {
        const email = values[0] as string;
        return [...mockRows.values()]
          .filter((r) => r.author === email)
          .sort((a, b) => b.updated_at - a.updated_at);
      }

      if (query.includes("select") && query.includes("from documents")) {
        const limit = values[0] as number;
        return [...mockRows.values()]
          .filter((r) => r.listed === 1)
          .sort((a, b) => b.updated_at - a.updated_at)
          .slice(0, limit);
      }

      return [];
    }
  },
}));

describe("DocumentRegistry", () => {
  let agent: InstanceType<
    typeof import("../../../agents/registry").default
  >;

  beforeEach(async () => {
    mockRows = new Map();
    mockHasFormatColumn = true;
    mockVisibilityColumn = "listed";
    const mod = await import("../../../agents/registry");
    agent = new mod.default({} as never, {} as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function upsert(body: unknown) {
    return agent.onRequest(
      new Request("https://registry/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  async function list(): Promise<RegistryEntry[]> {
    const res = await agent.onRequest(new Request("https://registry/"));
    const body = (await res.json()) as { documents: RegistryEntry[] };
    return body.documents;
  }

  describe("updated_at bumping", () => {
    it("preserves updated_at when bumpUpdated is false", async () => {
      await upsert({ id: "abc12345", title: "One", listed: true, author: "a@x" });
      const before = (await list())[0].updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      await upsert({
        id: "abc12345",
        title: "One",
        listed: true,
        author: "a@x",
        bumpUpdated: false,
      });
      const rows = await list();
      expect(rows[0].updatedAt).toBe(before);
    });

    it("bumps updated_at by default", async () => {
      await upsert({ id: "abc12345", title: "One", listed: true, author: "a@x" });
      const before = (await list())[0].updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      await upsert({ id: "abc12345", title: "One v2", listed: true, author: "a@x" });
      const after = (await list())[0].updatedAt;
      expect(after).toBeGreaterThan(before);
    });
  });

  async function byAuthor(email: unknown): Promise<RegistryEntry[]> {
    const res = await agent.onRequest(
      new Request("https://registry/by-author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    );
    const body = (await res.json()) as { documents: RegistryEntry[] };
    return body.documents;
  }

  function remove(body: unknown) {
    return agent.onRequest(
      new Request("https://registry/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  it("returns an empty list initially", async () => {
    expect(await list()).toEqual([]);
  });

  it("registers a listed document via upsert", async () => {
    const res = await upsert({
      id: "abc12345",
      title: "Hello",
      author: "Alice",
      listed: true,
    });
    expect(res.status).toBe(200);

    const docs = await list();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: "abc12345",
      title: "Hello",
      author: "Alice",
      listed: true,
    });
    expect(docs[0].createdAt).toBeTypeOf("number");
    expect(docs[0].updatedAt).toBe(docs[0].createdAt);
  });

  it("keeps unlisted documents out of the homepage listing", async () => {
    await upsert({ id: "pub1", title: "Pub", listed: true });
    await upsert({ id: "priv1", title: "Priv" });

    const docs = await list();
    expect(docs.map((d) => d.id)).toEqual(["pub1"]);
  });

  it("withdraws a document from the listing when it turns unlisted", async () => {
    await upsert({ id: "doc1", title: "T", listed: true });
    await upsert({ id: "doc1", title: "T", listed: false });

    expect(await list()).toEqual([]);
    // Still present for its author view
    await upsert({ id: "doc1", title: "T", author: "Alice", listed: false });
    expect((await byAuthor("Alice")).map((d) => d.id)).toEqual(["doc1"]);
  });

  it("lists all of an author's documents, listed and unlisted, newest first", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    await upsert({ id: "a1", title: "Old", author: "Alice", listed: true });
    vi.spyOn(Date, "now").mockReturnValue(2000);
    await upsert({ id: "a2", title: "New", author: "Alice", listed: false });
    await upsert({ id: "b1", title: "Other", author: "Bob", listed: true });

    const docs = await byAuthor("Alice");
    expect(docs.map((d) => d.id)).toEqual(["a2", "a1"]);
    expect(docs.map((d) => d.listed)).toEqual([false, true]);
  });

  it("rejects by-author without an email", async () => {
    const res = await agent.onRequest(
      new Request("https://registry/by-author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("v1 migration marks pre-existing rows listed and adopts orphans", async () => {
    // First-generation database: rows exist, no visibility column at all
    mockRows.set("old1", {
      id: "old1",
      title: "Legacy",
      author: null,
      listed: 0,
      created_at: 1,
      updated_at: 1,
    });
    mockRows.set("old2", {
      id: "old2",
      title: "Owned",
      author: "someone@vio.com",
      listed: 0,
      created_at: 2,
      updated_at: 2,
    });
    mockVisibilityColumn = "none";

    const docs = await list();
    expect(docs.map((d) => d.id)).toEqual(["old2", "old1"]);
    expect(mockVisibilityColumn).toBe("listed");

    const adopted = await byAuthor("pavel@vio.com");
    expect(adopted.map((d) => d.id)).toEqual(["old1"]);
    const kept = await byAuthor("someone@vio.com");
    expect(kept.map((d) => d.id)).toEqual(["old2"]);
  });

  it("v2 migration renames the public column without re-running backfills", async () => {
    // Second-generation database: column exists under the old name,
    // with a deliberately unlisted row and an authorless row that must
    // NOT be adopted (adoption belongs to the v1 step only).
    mockRows.set("old1", {
      id: "old1",
      title: "Hidden",
      author: null,
      listed: 0,
      created_at: 1,
      updated_at: 1,
    });
    mockVisibilityColumn = "public";

    expect(await list()).toEqual([]); // stays unlisted
    expect(mockVisibilityColumn).toBe("listed");
    expect(await byAuthor("pavel@vio.com")).toEqual([]); // not adopted
  });

  it("fresh databases need no migration and adopt nothing", async () => {
    await upsert({ id: "doc1", title: "T", listed: true }); // author null, fresh schema
    expect(mockVisibilityColumn).toBe("listed");
    const adopted = await byAuthor("pavel@vio.com");
    expect(adopted).toEqual([]);
  });

  it("updates title and updatedAt but preserves createdAt on re-upsert", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    await upsert({ id: "doc1", title: "First", listed: true });

    vi.spyOn(Date, "now").mockReturnValue(2000);
    await upsert({ id: "doc1", title: "Second", listed: true });

    const docs = await list();
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Second");
    expect(docs[0].createdAt).toBe(1000);
    expect(docs[0].updatedAt).toBe(2000);
  });

  it("keeps a previously known author when a later upsert has none", async () => {
    await upsert({ id: "doc1", title: "T", author: "Alice", listed: true });
    await upsert({ id: "doc1", title: "T2", listed: true });

    const docs = await list();
    expect(docs[0].author).toBe("Alice");
  });

  it("falls back to the id when title is missing or blank", async () => {
    await upsert({ id: "doc1", listed: true });
    await upsert({ id: "doc2", title: "   ", listed: true });

    const docs = await list();
    const byId = Object.fromEntries(docs.map((d) => [d.id, d.title]));
    expect(byId["doc1"]).toBe("doc1");
    expect(byId["doc2"]).toBe("doc2");
  });

  it("rejects upserts without an id", async () => {
    const res = await upsert({ title: "No id" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON", async () => {
    const res = await agent.onRequest(
      new Request("https://registry/upsert", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("lists newest first and caps at the registry limit", async () => {
    const total = REGISTRY_LIMIT + 20;
    for (let i = 0; i < total; i++) {
      vi.spyOn(Date, "now").mockReturnValue(1000 + i);
      await upsert({ id: `doc-${i}`, title: `Doc ${i}`, listed: true });
    }

    const docs = await list();
    expect(docs).toHaveLength(REGISTRY_LIMIT);
    expect(docs[0].id).toBe(`doc-${total - 1}`);
    expect(docs[docs.length - 1].id).toBe(`doc-${total - REGISTRY_LIMIT}`);
  });

  it("returns 404 for unsupported paths/methods", async () => {
    const res = await agent.onRequest(
      new Request("https://registry/other", { method: "PUT" }),
    );
    expect(res.status).toBe(404);
  });

  it("removes a document entirely", async () => {
    await upsert({ id: "abc12345", title: "Hello", author: "Alice", listed: true });
    await upsert({ id: "def67890", title: "World", listed: true });

    const res = await remove({ id: "abc12345" });
    expect(res.status).toBe(200);

    const docs = await list();
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe("def67890");
    expect(await byAuthor("Alice")).toEqual([]);
  });

  it("removing an unknown id succeeds and changes nothing", async () => {
    await upsert({ id: "abc12345", title: "Hello", listed: true });

    const res = await remove({ id: "no-such-doc" });
    expect(res.status).toBe(200);
    expect(await list()).toHaveLength(1);
  });

  it("rejects removal without an id", async () => {
    const res = await remove({});
    expect(res.status).toBe(400);
  });
});

