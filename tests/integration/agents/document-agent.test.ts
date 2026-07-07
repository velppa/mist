/**
 * DocumentAgent integration tests.
 *
 * Tests the actual DocumentAgent code with a mocked Agent base class.
 * The agents SDK uses cloudflare: protocol imports, so we mock the base
 * class and test lifecycle methods (onConnect, onMessage, onClose,
 * onRequest) directly.
 *
 * For Yjs sync tests, real Y.Doc clients exchange messages through the
 * actual agent code — testing the sync relay, SQL persistence, and
 * awareness propagation end-to-end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { DOC_FORMAT_VERSION } from "~/shared/constants";
import { YjsProvider } from "~/lib/yjs-provider";
import { REGISTRY_SYNC_DEBOUNCE_MS } from "../../../agents/document";

/* ------------------------------------------------------------------ */
/*  Mock Agent base class                                              */
/* ------------------------------------------------------------------ */

let mockSqlStore: Map<string, ArrayBuffer>;
let mockConnectionMap: Map<string, MockConnection>;
let mockAgentEnv: Record<string, unknown>;
let registryCalls: Array<{
  path: string;
  body: Record<string, unknown>;
}>;

vi.mock("agents", () => ({
  getAgentByName: async () => ({
    fetch: async (req: Request) => {
      registryCalls.push({
        path: new URL(req.url).pathname,
        body: (await req.json()) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ ok: true }));
    },
  }),
  Agent: class MockAgent {
    name = "test-doc";
    ctx = {};

    get env() {
      return mockAgentEnv;
    }

    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("$").toLowerCase().trim();

      if (query.includes("create table")) return [];

      if (query.includes("delete from doc_state")) {
        mockSqlStore.clear();
        return [];
      }

      if (query.includes("select") && query.includes("from doc_state")) {
        const match = query.match(/key\s*=\s*'(\w+)'/);
        if (match) {
          const buf = mockSqlStore.get(match[1]);
          if (buf) return [{ value: buf }];
        }
        return [];
      }

      if (query.includes("insert into doc_state")) {
        const match = query.match(/values\s*\(\s*'(\w+)'/i);
        if (match) {
          const val = values[0];
          if (val instanceof Uint8Array) {
            mockSqlStore.set(
              match[1],
              val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength),
            );
          }
        }
        return [];
      }

      return [];
    }

    getConnections() {
      return mockConnectionMap.values();
    }
  },
}));

/* ------------------------------------------------------------------ */
/*  Mock Connection (server-side WebSocket handle)                     */
/* ------------------------------------------------------------------ */

class MockConnection {
  id: string;
  closed = false;
  closeCode?: number;
  closeReason?: string;
  onSend?: (data: Uint8Array) => void;

  constructor(id: string) {
    this.id = id;
  }

  send(data: ArrayBuffer | Uint8Array) {
    const bytes =
      data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
    this.onSend?.(bytes);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }
}

/* ------------------------------------------------------------------ */
/*  Mock Socket (client-side WebSocket)                                */
/* ------------------------------------------------------------------ */

class MockSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockSocket.OPEN;
  binaryType = "blob";
  sent: Uint8Array[] = [];
  onSend?: (data: Uint8Array) => void;

  send(data: Uint8Array | ArrayBuffer) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    this.sent.push(bytes);
    this.onSend?.(bytes);
  }

  close() {
    this.readyState = MockSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  receiveMessage(data: Uint8Array) {
    const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.dispatchEvent(new MessageEvent("message", { data: copy }));
  }
}

Object.defineProperty(MockSocket.prototype, "OPEN", { value: 1 });
Object.defineProperty(MockSocket.prototype, "CONNECTING", { value: 0 });

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("DocumentAgent", () => {
  let DocumentAgent: typeof import("../../../agents/document").default;
  let agent: InstanceType<typeof DocumentAgent>;
  let nextConnId: number;

  beforeEach(async () => {
    vi.stubGlobal("WebSocket", MockSocket);
    mockSqlStore = new Map();
    mockConnectionMap = new Map();
    mockAgentEnv = {};
    registryCalls = [];
    nextConnId = 1;

    const mod = await import("../../../agents/document");
    DocumentAgent = mod.default;
    agent = new DocumentAgent({} as never, {} as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* ---- Helpers ---- */

  /** Create a bare MockConnection registered in the connection map. */
  function createConnection(): MockConnection {
    const conn = new MockConnection(`conn-${nextConnId++}`);
    mockConnectionMap.set(conn.id, conn);
    return conn;
  }

  /**
   * Connect a full Yjs client through the agent.
   *
   * Wiring:
   *   agent sends → connection.send → socket.receiveMessage → YjsProvider
   *   YjsProvider sends → socket.send → agent.onMessage
   */
  function connectYjsClient(targetAgent = agent) {
    const connId = `conn-${nextConnId++}`;
    const socket = new MockSocket();
    const connection = new MockConnection(connId);

    // Wire agent → client
    connection.onSend = (data) => socket.receiveMessage(data);

    // Create provider (attaches message listener to socket)
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const provider = new YjsProvider(
      socket as unknown as WebSocket,
      doc,
      awareness,
    );

    // Wire client → agent
    socket.onSend = (data) => {
      const buf = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      );
      targetAgent.onMessage(connection as never, buf);
    };

    // Register connection so getConnections() includes it
    mockConnectionMap.set(connId, connection);

    // Trigger sync handshake
    targetAgent.onConnect(connection as never, {} as never);

    return { doc, awareness, socket, connection, provider, connId };
  }

  function cleanup(...clients: Array<{ provider: YjsProvider; doc: Y.Doc }>) {
    for (const c of clients) {
      c.provider.destroy();
      c.doc.destroy();
    }
  }

  /* ================================================================ */
  /*  HTTP GET                                                         */
  /* ================================================================ */

  describe("GET /", () => {
    it("returns exists: false for a fresh agent", async () => {
      const res = await agent.onRequest(new Request("https://do/"));
      const body = await res.json();
      expect(body).toEqual({ exists: false, createdAt: null, author: null });
    });

    it("returns exists: true with createdAt after POST", async () => {
      const before = Date.now();
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const after = Date.now();

      const res = await agent.onRequest(new Request("https://do/"));
      const body = (await res.json()) as { exists: boolean; createdAt: number };
      expect(body.exists).toBe(true);
      expect(body.createdAt).toBeGreaterThanOrEqual(before);
      expect(body.createdAt).toBeLessThanOrEqual(after);
    });

    it("records the author from the x-mist-author header", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "x-mist-author": "pavel@vio.com" },
        }),
      );

      const res = await agent.onRequest(new Request("https://do/"));
      const body = (await res.json()) as { author: string | null };
      expect(body.author).toBe("pavel@vio.com");
    });

    it("leaves author null when no header is present", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      const res = await agent.onRequest(new Request("https://do/"));
      const body = (await res.json()) as { author: string | null };
      expect(body.author).toBeNull();
    });
  });

  /* ================================================================ */
  /*  HTTP POST                                                        */
  /* ================================================================ */

  describe("POST /", () => {
    it("returns { ok: true }", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", { method: "POST" }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("stamps DOC_FORMAT_VERSION in Yjs meta map", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      const client = connectYjsClient();
      expect(client.doc.getMap<number>("meta").get("version")).toBe(
        DOC_FORMAT_VERSION,
      );
      cleanup(client);
    });

    it("imports plain text content", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello world" }),
        }),
      );

      const client = connectYjsClient();
      const frag = client.doc.getXmlFragment("default");
      expect(frag.length).toBe(1);
      const para = frag.get(0) as Y.XmlElement;
      expect((para.get(0) as Y.XmlText).toString()).toBe("hello world");
      cleanup(client);
    });

    it("imports content with CriticMarkup marks", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello {++world++}" }),
        }),
      );

      const client = connectYjsClient();
      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      // XmlText.toString() includes formatting as XML tags, so check delta
      expect(ytext.toDelta()).toEqual([
        { insert: "hello " },
        { insert: "world", attributes: { criticAddition: {} } },
      ]);
      cleanup(client);
    });

    it("imports multiline content as separate paragraphs", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "line one\nline two\nline three" }),
        }),
      );

      const client = connectYjsClient();
      expect(client.doc.getXmlFragment("default").length).toBe(3);
      cleanup(client);
    });

    it("imports threads into Y.Map", async () => {
      const thread = { id: "t-1", commentText: "good point", replies: [] };
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "text", threads: [thread] }),
        }),
      );

      const client = connectYjsClient();
      const stored = JSON.parse(
        client.doc.getMap<string>("threads").get("t-1")!,
      );
      expect(stored.commentText).toBe("good point");
      cleanup(client);
    });

    it("returns 400 for unsupported CriticMarkup (substitution)", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello {~~old~>new~~}" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain("Unsupported CriticMarkup");
    });

    it("still creates doc even with malformed JSON body", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Document should still exist
      const getRes = await agent.onRequest(new Request("https://do/"));
      const body = (await getRes.json()) as { exists: boolean };
      expect(body.exists).toBe(true);
    });
  });

  /* ================================================================ */
  /*  Unsupported HTTP methods                                         */
  /* ================================================================ */

  describe("unsupported methods", () => {
    it("returns 404 for PUT", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", { method: "PUT" }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ================================================================ */
  /*  Yjs sync through the agent                                       */
  /* ================================================================ */

  describe("Yjs sync", () => {
    it("syncs content from client A to client B", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "hello from A");

      const b = connectYjsClient();
      expect(b.doc.getText("default").toString()).toBe("hello from A");
      cleanup(a, b);
    });

    it("syncs live edits bidirectionally", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.doc.getText("default").insert(0, "AAA");
      expect(b.doc.getText("default").toString()).toBe("AAA");

      b.doc.getText("default").insert(3, " BBB");
      expect(a.doc.getText("default").toString()).toBe("AAA BBB");
      cleanup(a, b);
    });

    it("persists state in SQL and restores on new agent instance", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "persisted data");
      cleanup(a);
      mockConnectionMap.clear();

      // Simulate DO restart: new agent instance, same SQL store
      const agent2 = new DocumentAgent({} as never, {} as never);
      const b = connectYjsClient(agent2);
      expect(b.doc.getText("default").toString()).toBe("persisted data");
      cleanup(b);
    });

    it("propagates awareness state between clients", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.awareness.setLocalStateField("user", {
        name: "Alice",
        color: "#E57373",
      });

      const stateA = b.awareness.getStates().get(a.doc.clientID);
      expect(stateA?.user).toEqual({ name: "Alice", color: "#E57373" });
      cleanup(a, b);
    });

    it("new client receives content after first client disconnects", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "before disconnect");
      a.provider.destroy();
      a.socket.close();
      mockConnectionMap.delete(a.connId);
      a.doc.destroy();

      const b = connectYjsClient();
      expect(b.doc.getText("default").toString()).toBe("before disconnect");
      cleanup(b);
    });

    it("handles rapid sequential edits", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      const text = a.doc.getText("default");
      for (let i = 0; i < 50; i++) {
        text.insert(text.length, `${i} `);
      }

      const expected = Array.from({ length: 50 }, (_, i) => `${i} `).join("");
      expect(b.doc.getText("default").toString()).toBe(expected);
      cleanup(a, b);
    });

    it("handles deletions synced between clients", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.doc.getText("default").insert(0, "hello world");
      expect(b.doc.getText("default").toString()).toBe("hello world");

      a.doc.getText("default").delete(6, 5);
      expect(b.doc.getText("default").toString()).toBe("hello ");
      cleanup(a, b);
    });
  });

  /* ================================================================ */
  /*  onMessage edge cases                                             */
  /* ================================================================ */

  describe("onMessage", () => {
    it("ignores string messages gracefully", async () => {
      const conn = createConnection();
      await agent.onConnect(conn as never, {} as never);
      // Should not throw
      await agent.onMessage(conn as never, "some string message");
    });
  });

  /* ================================================================ */
  /*  onClose                                                          */
  /* ================================================================ */

  describe("onClose", () => {
    it("does not throw when awareness is not initialised", async () => {
      const conn = createConnection();
      // Agent has never been initialised — awareness is null
      await agent.onClose(conn as never, 1000, "normal", true);
    });

    it("does not throw after agent is initialised", async () => {
      const conn = createConnection();
      await agent.onConnect(conn as never, {} as never);
      await agent.onClose(conn as never, 1000, "normal", true);
    });
  });

  /* ================================================================ */
  /*  Registry sync                                                    */
  /* ================================================================ */

  describe("registry sync", () => {
    beforeEach(() => {
      mockAgentEnv = { DocumentRegistry: {} };
    });

    it("registers a public document on POST with title and frontmatter author", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mist-public": "true",
          },
          body: JSON.stringify({
            content: "---\nauthor: Alice\n---\n# My Title\nbody text",
          }),
        }),
      );

      expect(registryCalls).toContainEqual({
        path: "/upsert",
        body: { id: "test-doc", title: "My Title", author: "Alice" },
      });
    });

    it("falls back to first line title and null author", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mist-public": "true",
          },
          body: JSON.stringify({ content: "just some text\nmore text" }),
        }),
      );

      expect(registryCalls).toContainEqual({
        path: "/upsert",
        body: { id: "test-doc", title: "just some text", author: null },
      });
    });

    it("registers an empty public document under its id", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "x-mist-public": "true" },
        }),
      );

      expect(registryCalls).toContainEqual({
        path: "/upsert",
        body: { id: "test-doc", title: "test-doc", author: null },
      });
    });

    it("does not list a document created without the public opt-in", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      expect(registryCalls.map((c) => c.path)).not.toContain("/upsert");
      expect(registryCalls).toContainEqual({
        path: "/remove",
        body: { id: "test-doc" },
      });
    });

    it("does not sync when the registry binding is absent", async () => {
      mockAgentEnv = {};
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      expect(registryCalls).toHaveLength(0);
    });

    it("debounces registry updates on edits into a single upsert", async () => {
      vi.useFakeTimers();
      try {
        await agent.onRequest(
          new Request("https://do/", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-mist-public": "true",
            },
            body: JSON.stringify({ content: "# Original" }),
          }),
        );
        registryCalls.length = 0;

        const client = connectYjsClient();
        const frag = client.doc.getXmlFragment("default");
        for (const text of ["# Draft 1", "# Draft 2", "# Updated Title"]) {
          const para = new Y.XmlElement("paragraph");
          para.insert(0, [new Y.XmlText(text)]);
          frag.insert(0, [para]);
        }

        // Nothing pushed before the debounce interval elapses
        expect(registryCalls).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(REGISTRY_SYNC_DEBOUNCE_MS + 50);

        expect(registryCalls).toHaveLength(1);
        expect(registryCalls[0]).toEqual({
          path: "/upsert",
          body: { id: "test-doc", title: "Updated Title", author: null },
        });
        cleanup(client);
      } finally {
        vi.useRealTimers();
      }
    });

    it("picks up frontmatter author added by an edit", async () => {
      vi.useFakeTimers();
      try {
        await agent.onRequest(
          new Request("https://do/", {
            method: "POST",
            headers: { "x-mist-public": "true" },
          }),
        );
        registryCalls.length = 0;

        const client = connectYjsClient();
        const frag = client.doc.getXmlFragment("default");
        const lines = ["---", "author: Bob", "---", "# Written"];
        for (let i = 0; i < lines.length; i++) {
          const para = new Y.XmlElement("paragraph");
          para.insert(0, [new Y.XmlText(lines[i])]);
          frag.insert(i, [para]);
        }

        await vi.advanceTimersByTimeAsync(REGISTRY_SYNC_DEBOUNCE_MS + 50);

        expect(registryCalls).toHaveLength(1);
        expect(registryCalls[0]).toEqual({
          path: "/upsert",
          body: { id: "test-doc", title: "Written", author: "Bob" },
        });
        cleanup(client);
      } finally {
        vi.useRealTimers();
      }
    });

    it("lists a document toggled public from a client", async () => {
      vi.useFakeTimers();
      try {
        await agent.onRequest(
          new Request("https://do/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "# Secret Draft" }),
          }),
        );
        registryCalls.length = 0;

        const client = connectYjsClient();
        client.doc.getMap<string>("docState").set("public", "true");

        await vi.advanceTimersByTimeAsync(REGISTRY_SYNC_DEBOUNCE_MS + 50);

        expect(registryCalls).toContainEqual({
          path: "/upsert",
          body: { id: "test-doc", title: "Secret Draft", author: null },
        });
        cleanup(client);
      } finally {
        vi.useRealTimers();
      }
    });

    it("withdraws a document toggled back to private", async () => {
      vi.useFakeTimers();
      try {
        await agent.onRequest(
          new Request("https://do/", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-mist-public": "true",
            },
            body: JSON.stringify({ content: "# Was Public" }),
          }),
        );
        registryCalls.length = 0;

        const client = connectYjsClient();
        client.doc.getMap<string>("docState").set("public", "false");

        await vi.advanceTimersByTimeAsync(REGISTRY_SYNC_DEBOUNCE_MS + 50);

        expect(registryCalls).toContainEqual({
          path: "/remove",
          body: { id: "test-doc" },
        });
        expect(registryCalls.map((c) => c.path)).not.toContain("/upsert");
        cleanup(client);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
