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
      const query = strings.join("$").toLowerCase().replace(/\s+/g, " ").trim();

      // The key is either a literal in the query text or a string parameter
      const literalKey = query.match(/key\s*=\s*'([\w:]+)'/)?.[1];
      const paramKey = values.find((v): v is string => typeof v === "string");
      const key = literalKey ?? paramKey;

      if (query.includes("create table")) return [];

      if (query.startsWith("delete from doc_state")) {
        if (query.includes("where")) {
          if (key) mockSqlStore.delete(key);
        } else {
          mockSqlStore.clear();
        }
        return [];
      }

      if (query.includes("select") && query.includes("from doc_state")) {
        const likeMatch = query.match(/key like '([\w:]+)%'/);
        if (likeMatch) {
          const prefix = likeMatch[1];
          return [...mockSqlStore.entries()]
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, v]) => ({ key: k, value: v }));
        }
        if (key) {
          const buf = mockSqlStore.get(key);
          if (buf) return [{ key, value: buf }];
        }
        return [];
      }

      if (query.includes("insert into doc_state")) {
        const insertKey =
          query.match(/values\s*\(\s*'([\w:]+)'/)?.[1] ?? paramKey;
        const blob = values.find((v): v is Uint8Array => v instanceof Uint8Array);
        if (insertKey && blob) {
          mockSqlStore.set(
            insertKey,
            blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
          );
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

  describe("plain text extraction", () => {
    it("excludes comment bodies from the raw text", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "css {==border-radius: 12px;==}{>>Too small<<} more",
          }),
        }),
      );
      const body = (await agent
        .onRequest(new Request("https://do/?include=text"))
        .then((r) => r.json())) as { text?: string };
      expect(body.text).toContain("border-radius: 12px;");
      expect(body.text).not.toContain("Too small");
    });

    it("excludes UI-added comments (suffixed y-tiptap mark keys)", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello world" }),
        }),
      );
      // Simulate the editor adding a comment: y-tiptap suffixes the
      // mark key with a discriminator for repeatable marks.
      const client = connectYjsClient();
      const frag = client.doc.getXmlFragment("default");
      const para = frag.get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      client.doc.transact(() => {
        ytext.insert(0, "UICOMMENT", { "criticComment--abc123": {} });
      });
      await Promise.resolve();

      const body = (await agent
        .onRequest(new Request("https://do/?include=text"))
        .then((r) => r.json())) as { text?: string };
      expect(body.text).toContain("hello world");
      expect(body.text).not.toContain("UICOMMENT");
      cleanup(client);
    });
  });

  describe("state chunking", () => {
    it("persists content larger than one chunk row and reloads it", async () => {
      // ~3 MB of text spans multiple 1.5 MB state chunks
      const bigContent = "line of text\n".repeat(240_000);
      const res = await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: bigContent }),
        }),
      );
      expect(res.status).toBe(200);

      const chunkKeys = [...mockSqlStore.keys()].filter((k) => k.startsWith("state:"));
      expect(chunkKeys.length).toBeGreaterThan(1);
      expect(mockSqlStore.has("state")).toBe(false);

      // A fresh agent over the same storage reconstructs the document
      const reloaded = new DocumentAgent({} as never, {} as never);
      const body = (await reloaded
        .onRequest(new Request("https://do/?include=text"))
        .then((r) => r.json())) as { text?: string };
      expect(body.text?.length).toBeGreaterThan(3_000_000);
    });
  });

  describe("GET /", () => {
    it("returns exists: false for a fresh agent", async () => {
      const res = await agent.onRequest(new Request("https://do/"));
      const body = await res.json();
      expect(body).toEqual({ exists: false, createdAt: null, author: null, title: null });
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

  describe("DELETE /", () => {
    beforeEach(() => {
      mockAgentEnv = { DocumentRegistry: {} };
    });

    it("wipes the document and withdraws it from the registry", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mist-listed": "true",
          },
          body: JSON.stringify({ content: "# Doomed" }),
        }),
      );
      registryCalls.length = 0;

      const res = await agent.onRequest(
        new Request("https://do/", { method: "DELETE" }),
      );
      expect(res.status).toBe(200);

      expect(registryCalls).toContainEqual({
        path: "/remove",
        body: { id: "test-doc" },
      });

      const getRes = await agent.onRequest(new Request("https://do/"));
      const body = (await getRes.json()) as { exists: boolean };
      expect(body.exists).toBe(false);
    });

    it("closes connected editors", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const client = connectYjsClient();
      const serverConn = [...mockConnectionMap.values()][0];

      await agent.onRequest(new Request("https://do/", { method: "DELETE" }));

      expect(serverConn.closed).toBe(true);
      cleanup(client);
    });

    it("deleting a never-created document succeeds", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", { method: "DELETE" }),
      );
      expect(res.status).toBe(200);
    });
  });

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

    it("registers a listed document on POST with title and frontmatter author", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mist-listed": "true",
          },
          body: JSON.stringify({
            content: "---\nauthor: Alice\n---\n# My Title\nbody text",
          }),
        }),
      );

      expect(registryCalls).toContainEqual({
        path: "/upsert",
        body: { id: "test-doc", title: "My Title", author: "Alice", listed: true },
      });
    });

    it("falls back to first line title and null author", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mist-listed": "true",
          },
          body: JSON.stringify({ content: "just some text\nmore text" }),
        }),
      );

      expect(registryCalls).toContainEqual({
        path: "/upsert",
        body: { id: "test-doc", title: "just some text", author: null, listed: true },
      });
    });

    it("registers an empty listed document under its id", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "x-mist-listed": "true" },
        }),
      );

      expect(registryCalls).toContainEqual({
        path: "/upsert",
        body: { id: "test-doc", title: "test-doc", author: null, listed: true },
      });
    });

    it("registers an unlisted document with the listed flag off", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      expect(registryCalls.map((c) => c.path)).not.toContain("/remove");
      expect(registryCalls).toContainEqual({
        path: "/upsert",
        body: { id: "test-doc", title: "test-doc", author: null, listed: false },
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
              "x-mist-listed": "true",
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
          body: { id: "test-doc", title: "Updated Title", author: null, listed: true },
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
            headers: { "x-mist-listed": "true" },
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
          body: { id: "test-doc", title: "Written", author: "Bob", listed: true },
        });
        cleanup(client);
      } finally {
        vi.useRealTimers();
      }
    });

    it("lists a document toggled listed from a client", async () => {
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
        client.doc.getMap<string>("docState").set("listed", "true");

        // Visibility flips bypass the debounce — only microtasks elapse
        await vi.advanceTimersByTimeAsync(0);

        expect(registryCalls).toContainEqual({
          path: "/upsert",
          body: { id: "test-doc", title: "Secret Draft", author: null, listed: true },
        });
        cleanup(client);
      } finally {
        vi.useRealTimers();
      }
    });

    it("re-registers a document toggled back to private as unlisted", async () => {
      vi.useFakeTimers();
      try {
        await agent.onRequest(
          new Request("https://do/", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-mist-listed": "true",
            },
            body: JSON.stringify({ content: "# Was Listed" }),
          }),
        );
        registryCalls.length = 0;

        const client = connectYjsClient();
        client.doc.getMap<string>("docState").set("listed", "false");

        // Withdrawal is immediate as well — only microtasks elapse
        await vi.advanceTimersByTimeAsync(0);

        expect(registryCalls).toContainEqual({
          path: "/upsert",
          body: {
            id: "test-doc",
            title: "Was Listed",
            author: null,
            listed: false,
          },
        });
        expect(registryCalls.map((c) => c.path)).not.toContain("/remove");
        cleanup(client);
      } finally {
        vi.useRealTimers();
      }
    });

    it("migrates the legacy docState key in place on load", async () => {
      // A document persisted before the rename carries "public" only
      const legacy = new Y.Doc();
      legacy.getMap<string>("docState").set("public", "true");
      legacy.getXmlFragment("default"); // shape parity with real docs
      const state = Y.encodeStateAsUpdate(legacy);
      mockSqlStore.set(
        "state",
        state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength),
      );

      const client = connectYjsClient();
      const docState = client.doc.getMap<string>("docState");
      expect(docState.get("listed")).toBe("true");
      expect(docState.get("public")).toBeUndefined();

      // The migrated state is persisted immediately (in the chunked
      // format): a second agent instance loading the stored blob sees
      // only the new key.
      const reloaded = new Y.Doc();
      Y.applyUpdate(reloaded, new Uint8Array(mockSqlStore.get("state:0")!));
      expect(reloaded.getMap<string>("docState").get("public")).toBeUndefined();
      expect(reloaded.getMap<string>("docState").get("listed")).toBe("true");
      cleanup(client);
    });

    it("keeps debouncing content edits after a visibility flip", async () => {
      vi.useFakeTimers();
      try {
        await agent.onRequest(
          new Request("https://do/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "# Draft" }),
          }),
        );
        const client = connectYjsClient();
        client.doc.getMap<string>("docState").set("listed", "true");
        await vi.advanceTimersByTimeAsync(0);
        registryCalls.length = 0;

        const frag = client.doc.getXmlFragment("default");
        const para = new Y.XmlElement("paragraph");
        para.insert(0, [new Y.XmlText("# Renamed")]);
        frag.insert(0, [para]);

        // An ordinary edit must not sync before the debounce elapses
        expect(registryCalls).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(REGISTRY_SYNC_DEBOUNCE_MS + 50);

        expect(registryCalls).toEqual([
          {
            path: "/upsert",
            body: { id: "test-doc", title: "Renamed", author: null, listed: true },
          },
        ]);
        cleanup(client);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
