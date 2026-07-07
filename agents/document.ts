import { Agent, getAgentByName } from "agents";
import type { Connection, ConnectionContext, WSMessage } from "agents";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  MSG_SYNC,
  MSG_AWARENESS,
  DOC_FORMAT_VERSION,
  REGISTRY_AGENT_NAME,
} from "../app/shared/constants";
import { extractDocMeta } from "../app/lib/doc-meta";

/**
 * How long to wait after the last Yjs update before pushing fresh
 * metadata to the registry. Keeps the registry off the hot path of
 * every keystroke.
 */
export const REGISTRY_SYNC_DEBOUNCE_MS = 3000;

/**
 * Durable Objects SQLite accepts Uint8Array for BLOB columns via the
 * template literal API, but the type signature expects string. This
 * helper makes the cast explicit and grep-able.
 */
function sqlBlob(data: Uint8Array): string {
  return data as unknown as string;
}

/**
 * Extract the plain text of a Yjs XML node, ignoring formatting marks
 * (CriticMarkup additions/deletions render as attributes, not text).
 */
function xmlNodeText(node: ReturnType<Y.XmlFragment["get"]>): string {
  if (node instanceof Y.XmlText) {
    return (node.toDelta() as Array<{ insert?: unknown }>)
      .map((op) => (typeof op.insert === "string" ? op.insert : ""))
      .join("");
  }
  if (node instanceof Y.XmlElement) {
    let text = "";
    for (let i = 0; i < node.length; i++) {
      text += xmlNodeText(node.get(i));
    }
    return text;
  }
  return "";
}

class DocumentAgent extends Agent {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  private registrySyncTimer: ReturnType<typeof setTimeout> | null = null;

  private ensureInitialised(): { doc: Y.Doc; awareness: awarenessProtocol.Awareness } {
    if (this.doc && this.awareness) {
      return { doc: this.doc, awareness: this.awareness };
    }

    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    // Create table if needed
    this.sql`
      CREATE TABLE IF NOT EXISTS doc_state (
        key TEXT PRIMARY KEY,
        value BLOB
      )
    `;

    // Load persisted state
    const rows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = 'state'
    `;

    if (rows.length > 0 && rows[0].value) {
      const state = new Uint8Array(rows[0].value);
      Y.applyUpdate(this.doc, state);
    }

    // Persist on every update
    this.doc.on("update", () => {
      const state = Y.encodeStateAsUpdate(this.doc!);
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('state', ${sqlBlob(state)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;

      // Refresh the homepage registry entry, debounced so a burst of
      // edits results in a single registry write.
      this.scheduleRegistrySync();
    });

    return { doc: this.doc, awareness: this.awareness };
  }

  /** Plain markdown text of the document, one line per paragraph. */
  private getPlainText(doc: Y.Doc): string {
    const frag = doc.getXmlFragment("default");
    const lines: string[] = [];
    for (let i = 0; i < frag.length; i++) {
      lines.push(xmlNodeText(frag.get(i)));
    }
    return lines.join("\n");
  }

  private scheduleRegistrySync() {
    if (this.registrySyncTimer) {
      clearTimeout(this.registrySyncTimer);
    }
    this.registrySyncTimer = setTimeout(() => {
      this.registrySyncTimer = null;
      void this.syncRegistry();
    }, REGISTRY_SYNC_DEBOUNCE_MS);
  }

  /** Verified submitter email recorded at creation time, if any. */
  private getStoredAuthor(): string | null {
    const rows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = 'author'
    `;
    return rows.length > 0 ? new TextDecoder().decode(rows[0].value) : null;
  }

  /**
   * Documents are private (unlisted) by default; the shared docState
   * map carries the public opt-in so the toggle syncs to all clients.
   */
  private isPublic(doc: Y.Doc): boolean {
    return doc.getMap<string>("docState").get("public") === "true";
  }

  /**
   * Push this document's metadata to the singleton DocumentRegistry —
   * or remove it, since only public documents may be listed. The
   * verified submitter email takes precedence over a frontmatter
   * author claim. Registry failures must never break document editing,
   * so errors are swallowed.
   */
  private async syncRegistry() {
    if (this.registrySyncTimer) {
      clearTimeout(this.registrySyncTimer);
      this.registrySyncTimer = null;
    }

    const namespace = (this.env as Env | undefined)?.DocumentRegistry;
    if (!namespace) return;

    try {
      const { doc } = this.ensureInitialised();
      const registry = await getAgentByName(namespace, REGISTRY_AGENT_NAME);

      if (!this.isPublic(doc)) {
        await registry.fetch(
          new Request("https://registry/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: this.name }),
          }),
        );
        return;
      }

      const { title, author } = extractDocMeta(this.getPlainText(doc));
      await registry.fetch(
        new Request("https://registry/upsert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: this.name,
            title: title ?? this.name,
            author: this.getStoredAuthor() ?? author,
          }),
        }),
      );
    } catch {
      // Registry is best-effort — the document itself is already safe
    }
  }

  async onConnect(connection: Connection, _ctx: ConnectionContext) {
    const { doc, awareness } = this.ensureInitialised();

    // Send SyncStep1 to the new client
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    connection.send(encoding.toUint8Array(syncEncoder));

    // Send SyncStep2 (full state) to the new client
    const stateEncoder = encoding.createEncoder();
    encoding.writeVarUint(stateEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep2(stateEncoder, doc);
    connection.send(encoding.toUint8Array(stateEncoder));

    // Send current awareness states to the new client
    const awarenessStates = awareness.getStates();
    if (awarenessStates.size > 0) {
      const clients = Array.from(awarenessStates.keys());
      const update = awarenessProtocol.encodeAwarenessUpdate(awareness, clients);
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(awarenessEncoder, update);
      connection.send(encoding.toUint8Array(awarenessEncoder));
    }
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message === "string") {
      // JSON control messages — reserved for future use
      return;
    }

    const { doc, awareness } = this.ensureInitialised();

    const data =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(
            (message as Uint8Array).buffer,
            (message as Uint8Array).byteOffset,
            (message as Uint8Array).byteLength,
          );
    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, null);

        // If there's a response (e.g. SyncStep2 reply), send it back
        if (encoding.length(encoder) > 1) {
          connection.send(encoding.toUint8Array(encoder));
        }

        // Broadcast the raw message to all other clients
        this.broadcastBinary(message, connection.id);
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(awareness, update, connection);

        // Broadcast awareness to all other clients
        this.broadcastBinary(message, connection.id);
        break;
      }
    }
  }

  async onClose(
    connection: Connection,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    if (this.awareness) {
      // Remove this client's awareness state
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        // Agents SDK uses string IDs; awareness protocol expects numbers.
      // The protocol converts via toString() internally, so this is safe.
      [connection.id as unknown as number],
        null,
      );
    }
  }

  async onRequest(request: Request) {
    if (request.method === "POST") {
      // Create / initialise the document
      const { doc } = this.ensureInitialised();
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('exists', ${sqlBlob(new Uint8Array([1]))})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;

      // Stamp doc format version in Yjs metadata
      const meta = doc.getMap<number>("meta");
      if (!meta.has("version")) {
        meta.set("version", DOC_FORMAT_VERSION);
      }

      // Store creation timestamp
      const now = Date.now();
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('createdAt', ${sqlBlob(new Uint8Array(new Float64Array([now]).buffer))})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;

      // Record the authenticated creator, if the worker verified one.
      // The header is set only by trusted code (worker entry / new route),
      // never passed through from clients.
      const author = request.headers.get("x-mist-author");
      if (author) {
        this.sql`
          INSERT INTO doc_state (key, value) VALUES ('author', ${sqlBlob(new TextEncoder().encode(author))})
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `;
      }

      // Visibility opt-in (frontmatter `public: true` forwarded by /new).
      // Lives in the shared docState map so clients see and toggle it.
      if (request.headers.get("x-mist-public") === "true") {
        doc.getMap<string>("docState").set("public", "true");
      }

      // If the request has a JSON body with content, populate the Yjs doc
      const contentType = request.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        try {
          const body = await request.json() as { content?: string; threads?: unknown[]; onboarding?: boolean };
          if (body.content) {
            // Parse CriticMarkup and apply as marks on XmlText
            const { parseCriticMarkupToContent } = await import("../app/lib/critic-parser");
            const frag = doc.getXmlFragment("default");
            if (frag.length === 0) {
              const lines = body.content.split("\n");
              for (const line of lines) {
                const { cleanText, marks } = parseCriticMarkupToContent(line);
                const para = new Y.XmlElement("paragraph");
                const ytext = new Y.XmlText(cleanText);
                // Apply marks via Yjs formatting attributes
                for (const mark of marks) {
                  const attrs: Record<string, Record<string, unknown>> = {};
                  attrs[mark.type] = mark.attrs ?? {};
                  ytext.format(mark.from, mark.to - mark.from, attrs);
                }
                para.insert(0, [ytext]);
                frag.insert(frag.length, [para]);
              }
            }
          }
          if (body.threads && Array.isArray(body.threads)) {
            const threadsMap = doc.getMap<string>("threads");
            for (const thread of body.threads) {
              const t = thread as { id?: string };
              if (t.id) {
                threadsMap.set(t.id, JSON.stringify(thread));
              }
            }
          }
          if (body.onboarding) {
            const docState = doc.getMap<string>("docState");
            docState.set("onboarding", "true");
          }
        } catch (err) {
          // If it's an unsupported CriticMarkup error, return it
          if (err instanceof Error && err.message.includes("Unsupported CriticMarkup")) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          // Ignore other malformed JSON — document is still created
        }
      }

      // Register the new document immediately so it shows up on the
      // homepage without waiting for the debounced sync.
      await this.syncRegistry();

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET") {
      // Check whether this document exists
      this.ensureInitialised();
      const rows = this.sql<{ value: ArrayBuffer }>`
        SELECT value FROM doc_state WHERE key = 'exists'
      `;
      const exists = rows.length > 0;

      const createdAtRows = this.sql<{ value: ArrayBuffer }>`
        SELECT value FROM doc_state WHERE key = 'createdAt'
      `;
      const createdAt =
        createdAtRows.length > 0
          ? new Float64Array(createdAtRows[0].value)[0]
          : null;

      const author = this.getStoredAuthor();

      return new Response(JSON.stringify({ exists, createdAt, author }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private broadcastBinary(message: WSMessage, excludeId: string) {
    // Make a clean copy to avoid ArrayBufferView offset issues
    const bytes =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(
            (message as Uint8Array).buffer,
            (message as Uint8Array).byteOffset,
            (message as Uint8Array).byteLength,
          );
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    for (const conn of this.getConnections()) {
      if (conn.id !== excludeId) {
        conn.send(buf);
      }
    }
  }
}

export default DocumentAgent;
