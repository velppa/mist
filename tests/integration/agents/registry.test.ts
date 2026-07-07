/**
 * DocumentRegistry integration tests.
 *
 * Tests the registry agent's HTTP interface with a mocked Agent base
 * class (the agents SDK uses cloudflare: protocol imports). The SQL
 * mock emulates the small subset of SQLite the registry uses: an
 * upsert keyed by id and a newest-first, limited SELECT.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { REGISTRY_LIMIT } from "~/shared/constants";
import type { RegistryEntry } from "~/shared/types";

interface Row {
  id: string;
  title: string;
  author: string | null;
  created_at: number;
  updated_at: number;
}

let mockRows: Map<string, Row>;

vi.mock("agents", () => ({
  Agent: class MockAgent {
    name = "registry";
    env = {};

    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("?").toLowerCase();

      if (query.includes("create table")) return [];

      if (query.includes("insert into documents")) {
        const [id, title, author, createdAt, updatedAt] = values as [
          string,
          string,
          string | null,
          number,
          number,
        ];
        const existing = mockRows.get(id);
        if (existing) {
          // Emulates ON CONFLICT: keep created_at, COALESCE author
          mockRows.set(id, {
            ...existing,
            title,
            author: author ?? existing.author,
            updated_at: updatedAt,
          });
        } else {
          mockRows.set(id, {
            id,
            title,
            author,
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

      if (query.includes("select") && query.includes("from documents")) {
        const limit = values[0] as number;
        return [...mockRows.values()]
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

  it("registers a document via upsert", async () => {
    const res = await upsert({ id: "abc12345", title: "Hello", author: "Alice" });
    expect(res.status).toBe(200);

    const docs = await list();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: "abc12345",
      title: "Hello",
      author: "Alice",
    });
    expect(docs[0].createdAt).toBeTypeOf("number");
    expect(docs[0].updatedAt).toBe(docs[0].createdAt);
  });

  it("updates title and updatedAt but preserves createdAt on re-upsert", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    await upsert({ id: "doc1", title: "First" });

    vi.spyOn(Date, "now").mockReturnValue(2000);
    await upsert({ id: "doc1", title: "Second" });

    const docs = await list();
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Second");
    expect(docs[0].createdAt).toBe(1000);
    expect(docs[0].updatedAt).toBe(2000);
  });

  it("keeps a previously known author when a later upsert has none", async () => {
    await upsert({ id: "doc1", title: "T", author: "Alice" });
    await upsert({ id: "doc1", title: "T2" });

    const docs = await list();
    expect(docs[0].author).toBe("Alice");
  });

  it("falls back to the id when title is missing or blank", async () => {
    await upsert({ id: "doc1" });
    await upsert({ id: "doc2", title: "   " });

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
      await upsert({ id: `doc-${i}`, title: `Doc ${i}` });
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

  it("removes a document from the listing", async () => {
    await upsert({ id: "abc12345", title: "Hello" });
    await upsert({ id: "def67890", title: "World" });

    const res = await remove({ id: "abc12345" });
    expect(res.status).toBe(200);

    const docs = await list();
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe("def67890");
  });

  it("removing an unknown id succeeds and changes nothing", async () => {
    await upsert({ id: "abc12345", title: "Hello" });

    const res = await remove({ id: "no-such-doc" });
    expect(res.status).toBe(200);
    expect(await list()).toHaveLength(1);
  });

  it("rejects removal without an id", async () => {
    const res = await remove({});
    expect(res.status).toBe(400);
  });
});
