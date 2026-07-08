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
  REGISTRY_AGENT_NAME, docFormat } from "../app/shared/constants";
import { extractDocMetaForFormat } from "../app/lib/doc-meta";
import {
  LISTED_KEY,
  readListedFlag,
  migrateLegacyListedKey,
} from "../app/shared/doc-state";

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
function xmlNodeText(node: ReturnType<Y.XmlFragment["get"]> | Y.XmlHook): string {
  if (node instanceof Y.XmlText) {
    return (node.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>)
      .map((op) => {
        // Comment bodies live in the text stream under a criticComment
        // mark; they are annotations, not document content. y-tiptap
        // suffixes repeatable mark keys ("criticComment--<id>").
        const marked = op.attributes &&
          Object.keys(op.attributes).some(
            (k) => k === "criticComment" || k.startsWith("criticComment--"),
          );
        if (marked) return "";
        return typeof op.insert === "string" ? op.insert : "";
      })
      .join("");
  }
  if (node instanceof Y.XmlElement) {
    // toArray, not get(i): indexed access walks the item list from the
    // head each time, turning the scan quadratic on large documents.
    return node.toArray().map(xmlNodeText).join("");
  }
  return "";
}

class DocumentAgent extends Agent {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  private registrySyncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastKnownListed = false;

  /**
   * Durable Object SQLite caps a single value at 2 MB, so the Yjs state
   * blob is stored in fixed-size chunks (state:0, state:1, ...).
   */
  private static readonly STATE_CHUNK_BYTES = 1_500_000;

  private saveState(state: Uint8Array) {
    const chunkCount = Math.max(1, Math.ceil(state.length / DocumentAgent.STATE_CHUNK_BYTES));
    for (let i = 0; i < chunkCount; i++) {
      const chunk = state.subarray(
        i * DocumentAgent.STATE_CHUNK_BYTES,
        (i + 1) * DocumentAgent.STATE_CHUNK_BYTES,
      );
      const key = `state:${i}`;
      this.sql`
        INSERT INTO doc_state (key, value) VALUES (${key}, ${sqlBlob(chunk)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
    }
    // Drop stale higher chunks from a previously larger state, and the
    // pre-chunking single-row format.
    const rows = this.sql<{ key: string }>`
      SELECT key FROM doc_state WHERE key LIKE 'state:%'
    `;
    for (const row of rows) {
      const index = Number(row.key.slice("state:".length));
      if (index >= chunkCount) {
        this.sql`DELETE FROM doc_state WHERE key = ${row.key}`;
      }
    }
    this.sql`DELETE FROM doc_state WHERE key = 'state'`;
  }

  private loadState(): Uint8Array | null {
    const chunkRows = this.sql<{ key: string; value: ArrayBuffer }>`
      SELECT key, value FROM doc_state WHERE key LIKE 'state:%'
    `;
    if (chunkRows.length > 0) {
      chunkRows.sort(
        (a, b) => Number(a.key.slice("state:".length)) - Number(b.key.slice("state:".length)),
      );
      const total = chunkRows.reduce((n, r) => n + r.value.byteLength, 0);
      const state = new Uint8Array(total);
      let offset = 0;
      for (const row of chunkRows) {
        state.set(new Uint8Array(row.value), offset);
        offset += row.value.byteLength;
      }
      return state;
    }
    // Pre-chunking format: single 'state' row
    const rows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = 'state'
    `;
    return rows.length > 0 && rows[0].value ? new Uint8Array(rows[0].value) : null;
  }

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
    const state = this.loadState();
    if (state) {
      Y.applyUpdate(this.doc, state);
    }
    // Rename migration: move the legacy "public" docState key to
    // "listed" in place so clients only ever see the new key, and
    // persist right away so the migration survives a restart even if
    // the document is never edited again.
    const docStateMap = this.doc.getMap<string>("docState");
    let migrated = false;
    this.doc.transact(() => {
      migrated = migrateLegacyListedKey(docStateMap);
    });
    if (migrated) {
      this.saveState(Y.encodeStateAsUpdate(this.doc));
    }
    this.lastKnownListed = this.isListed(this.doc);

    // Persist on every update
    this.doc.on("update", () => {
      this.saveState(Y.encodeStateAsUpdate(this.doc!));

      // Visibility flips must reach the homepage immediately; ordinary
      // edits stay debounced so a burst results in a single registry write.
      const listed = this.isListed(this.doc!);
      if (listed !== this.lastKnownListed) {
        this.lastKnownListed = listed;
        void this.syncRegistry();
      } else {
        this.scheduleRegistrySync();
      }
    });

    return { doc: this.doc, awareness: this.awareness };
  }

  /** Plain markdown text of the document, one line per paragraph. */
  private getPlainText(doc: Y.Doc): string {
    const frag = doc.getXmlFragment("default");
    return frag.toArray().map(xmlNodeText).join("\n");
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
   * Documents are unlisted by default; the shared docState map carries
   * the listing opt-in so the toggle syncs to all clients.
   */
  private isListed(doc: Y.Doc): boolean {
    return readListedFlag(doc.getMap<string>("docState"));
  }

  /**
   * Push this document's metadata to the singleton DocumentRegistry.
   * Unlisted documents stay registered (flagged) so their owner can
   * find them under "My docs"; only the homepage filters on listed.
   * The verified submitter email takes precedence over a frontmatter
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

      const { title, author } = extractDocMetaForFormat(this.getPlainText(doc), docFormat(this.name));
      await registry.fetch(
        new Request("https://registry/upsert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: this.name,
            title: title ?? this.name,
            author: this.getStoredAuthor() ?? author,
            listed: this.isListed(doc),
          }),
        }),
      );
    } catch {
      // Registry is best-effort — the document itself is already safe
    }
  }

  /** Withdraw this document from the registry entirely (deletion). */
  private async removeFromRegistry() {
    const namespace = (this.env as Env | undefined)?.DocumentRegistry;
    if (!namespace) return;

    try {
      const registry = await getAgentByName(namespace, REGISTRY_AGENT_NAME);
      await registry.fetch(
        new Request("https://registry/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: this.name }),
        }),
      );
    } catch {
      // Best-effort; a stale entry points at a 404 doc at worst
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

      // Listing opt-in (frontmatter `listed: true` forwarded by /new).
      // Lives in the shared docState map so clients see and toggle it.
      if (request.headers.get("x-mist-listed") === "true") {
        doc.getMap<string>("docState").set(LISTED_KEY, "true");
      }

      // If the request has a JSON body with content, populate the Yjs doc
      const contentType = request.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        try {
          const body = await request.json() as { content?: string; threads?: unknown[]; onboarding?: boolean };
          // One transaction for the whole initial body: without it every
          // paragraph insert fires an update event, each re-encoding and
          // persisting the full state — quadratic on large uploads.
          const { parseCriticMarkupToContent } = await import("../app/lib/critic-parser");
          doc.transact(() => {
            if (body.content) {
              // Parse CriticMarkup and apply as marks on XmlText
              const frag = doc.getXmlFragment("default");
              if (frag.length === 0) {
                const lines = body.content!.split("\n");
                // Build all paragraphs first and insert once: indexed
                // inserts walk the item list from the head, so per-line
                // appends are quadratic on large documents.
                const paras = lines.map((line) => {
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
                  return para;
                });
                frag.insert(0, paras);
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
          });
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

      // Same title derivation the registry uses, so the page <title>
      // matches the "My docs" listing.
      const { doc } = this.ensureInitialised();
      const text = this.getPlainText(doc);
      const { title } = extractDocMetaForFormat(text, docFormat(this.name));

      const body: Record<string, unknown> = { exists, createdAt, author, title };
      // The /raw route needs the verbatim document text
      if (new URL(request.url).searchParams.get("include") === "text") {
        body.text = text;
      }

      return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "DELETE") {
      // Disconnect editors first so no update re-persists state below
      for (const conn of this.getConnections()) {
        conn.close();
      }
      if (this.registrySyncTimer) {
        clearTimeout(this.registrySyncTimer);
        this.registrySyncTimer = null;
      }
      this.doc = null;
      this.awareness = null;
      this.lastKnownListed = false;

      // The table may not exist yet when deleting a never-created doc
      this.sql`
        CREATE TABLE IF NOT EXISTS doc_state (
          key TEXT PRIMARY KEY,
          value BLOB
        )
      `;
      this.sql`DELETE FROM doc_state`;
      await this.removeFromRegistry();

      return new Response(JSON.stringify({ ok: true }), {
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
