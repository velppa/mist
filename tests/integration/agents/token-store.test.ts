/**
 * TokenStore integration tests.
 *
 * Mirrors the registry test setup: the Agent base class is mocked and a
 * small SQL emulation covers the queries the store issues against its
 * tokens table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sha256Hex } from "~/lib/auth.server";
import type { TokenInfo } from "../../../agents/tokens";

interface Row {
  token_hash: string;
  email: string;
  label: string;
  token_prefix: string;
  created_at: number;
}

let mockRows: Map<string, Row>;

vi.mock("agents", () => ({
  Agent: class MockAgent {
    name = "tokens";
    env = {};

    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("?").toLowerCase();

      if (query.includes("create table")) return [];

      if (query.includes("insert into tokens")) {
        const [hash, email, label, prefix, createdAt] = values as [
          string,
          string,
          string,
          string,
          number,
        ];
        mockRows.set(hash, {
          token_hash: hash,
          email,
          label,
          token_prefix: prefix,
          created_at: createdAt,
        });
        return [];
      }

      if (query.includes("select token_hash, email, label")) {
        const email = values[0] as string;
        return [...mockRows.values()]
          .filter((r) => r.email === email)
          .sort((a, b) => b.created_at - a.created_at);
      }

      if (query.includes("select token_hash from tokens")) {
        const [id, email] = values as [string, string];
        return [...mockRows.values()].filter(
          (r) => r.token_hash === id && r.email === email,
        );
      }

      if (query.includes("select email from tokens")) {
        const hash = values[0] as string;
        return [...mockRows.values()].filter((r) => r.token_hash === hash);
      }

      if (query.includes("delete from tokens")) {
        const [id, email] = values as [string, string];
        const row = mockRows.get(id);
        if (row && row.email === email) mockRows.delete(id);
        return [];
      }

      if (query.includes("update tokens set label")) {
        const [label, id, email] = values as [string, string, string];
        const row = mockRows.get(id);
        if (row && row.email === email) row.label = label;
        return [];
      }

      return [];
    }
  },
}));

describe("TokenStore", () => {
  let store: InstanceType<typeof import("../../../agents/tokens").default>;

  beforeEach(async () => {
    mockRows = new Map();
    const mod = await import("../../../agents/tokens");
    store = new mod.default({} as never, {} as never);
  });

  function call(path: string, body: unknown) {
    return store.onRequest(
      new Request(`https://tokens${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  async function listTokens(email: string): Promise<TokenInfo[]> {
    const res = await call("/list", { email });
    return ((await res.json()) as { tokens: TokenInfo[] }).tokens;
  }

  it("creates a token and returns the plaintext exactly once", async () => {
    const res = await call("/create", { email: "alice@vio.com", label: "cli" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; info: TokenInfo };

    expect(body.token).toMatch(/^mist_[A-Za-z0-9_-]+$/);
    expect(body.info.label).toBe("cli");
    expect(body.info.prefix).toBe(body.token.slice(0, 8));

    // Stored row holds the hash, never the plaintext.
    const stored = [...mockRows.values()][0];
    expect(stored.token_hash).toBe(await sha256Hex(body.token));
    expect(JSON.stringify(stored)).not.toContain(body.token);
  });

  it("lists only the requesting user's tokens, newest first", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    await call("/create", { email: "alice@vio.com", label: "one" });
    vi.spyOn(Date, "now").mockReturnValue(2000);
    await call("/create", { email: "alice@vio.com", label: "two" });
    await call("/create", { email: "bob@vio.com", label: "bobs" });
    vi.restoreAllMocks();

    const tokens = await listTokens("alice@vio.com");
    expect(tokens.map((t) => t.label)).toEqual(["two", "one"]);
  });

  it("resolves a token to its owner via lookup", async () => {
    const created = (await (
      await call("/create", { email: "alice@vio.com", label: "cli" })
    ).json()) as { token: string };

    const res = await call("/lookup", { token: created.token });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { email: string }).email).toBe(
      "alice@vio.com",
    );
  });

  it("returns 404 when looking up an unknown token", async () => {
    const res = await call("/lookup", { token: "mist_nope" });
    expect(res.status).toBe(404);
  });

  it("revokes a token so lookup stops resolving it", async () => {
    const created = (await (
      await call("/create", { email: "alice@vio.com", label: "cli" })
    ).json()) as { token: string; info: TokenInfo };

    const res = await call("/revoke", {
      email: "alice@vio.com",
      id: created.info.id,
    });
    expect(res.status).toBe(200);

    expect((await call("/lookup", { token: created.token })).status).toBe(404);
    expect(await listTokens("alice@vio.com")).toHaveLength(0);
  });

  it("refuses to revoke another user's token", async () => {
    const created = (await (
      await call("/create", { email: "alice@vio.com", label: "cli" })
    ).json()) as { info: TokenInfo };

    const res = await call("/revoke", {
      email: "bob@vio.com",
      id: created.info.id,
    });
    expect(res.status).toBe(404);
    expect(await listTokens("alice@vio.com")).toHaveLength(1);
  });

  it("renames a token, scoped to its owner", async () => {
    const created = (await (
      await call("/create", { email: "alice@vio.com", label: "old" })
    ).json()) as { info: TokenInfo };

    const wrongUser = await call("/rename", {
      email: "bob@vio.com",
      id: created.info.id,
      label: "hacked",
    });
    expect(wrongUser.status).toBe(404);

    const ok = await call("/rename", {
      email: "alice@vio.com",
      id: created.info.id,
      label: "new",
    });
    expect(ok.status).toBe(200);

    const tokens = await listTokens("alice@vio.com");
    expect(tokens[0].label).toBe("new");
  });

  it("validates required fields", async () => {
    expect((await call("/create", {})).status).toBe(400);
    expect((await call("/list", {})).status).toBe(400);
    expect((await call("/revoke", { email: "a@b.c" })).status).toBe(400);
    expect(
      (await call("/rename", { email: "a@b.c", id: "x" })).status,
    ).toBe(400);
    expect((await call("/lookup", {})).status).toBe(400);
  });

  it("rejects invalid JSON and unknown paths", async () => {
    const badJson = await store.onRequest(
      new Request("https://tokens/create", { method: "POST", body: "nope" }),
    );
    expect(badJson.status).toBe(400);

    const unknown = await call("/other", {});
    expect(unknown.status).toBe(404);

    const get = await store.onRequest(new Request("https://tokens/list"));
    expect(get.status).toBe(404);
  });
});
