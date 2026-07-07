import { Agent } from "agents";
import { base64UrlEncode, sha256Hex } from "../app/lib/auth.server";

/**
 * A token row never stores the token itself — only its SHA-256 hash.
 * The prefix (first characters of the plaintext) is kept so users can
 * tell their tokens apart in the management UI.
 */
interface TokenRow {
  token_hash: string;
  email: string;
  label: string;
  token_prefix: string;
  created_at: number;
}

/** Shape returned to the management UI; the hash doubles as an opaque id. */
export interface TokenInfo {
  id: string;
  label: string;
  prefix: string;
  createdAt: number;
}

const TOKEN_BYTES = 32;
const PREFIX_LENGTH = 8; // "mist_" + 3 chars of entropy — enough to recognise

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * TokenStore is a singleton Durable Object (instance name "tokens")
 * holding user-issued API tokens. It must never be reachable from the
 * public internet — the worker entry point rejects /agents/token-store/*
 * — because its endpoints trust the email in the request body, which is
 * only ever set server-side from a verified session.
 */
class TokenStore extends Agent {
  private ensureTable() {
    this.sql`
      CREATE TABLE IF NOT EXISTS tokens (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        label TEXT NOT NULL,
        token_prefix TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
  }

  async onRequest(request: Request): Promise<Response> {
    this.ensureTable();
    const url = new URL(request.url);

    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: "invalid JSON" }, 400);
    }

    switch (url.pathname) {
      case "/create":
        return this.create(payload);
      case "/list":
        return this.list(payload);
      case "/revoke":
        return this.revoke(payload);
      case "/rename":
        return this.rename(payload);
      case "/lookup":
        return this.lookup(payload);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  private async create(payload: Record<string, unknown>): Promise<Response> {
    if (!isNonEmptyString(payload.email)) {
      return json({ ok: false, error: "email is required" }, 400);
    }
    const label = isNonEmptyString(payload.label)
      ? payload.label.trim()
      : "unnamed token";

    const bytes = new Uint8Array(TOKEN_BYTES);
    crypto.getRandomValues(bytes);
    const token = `mist_${base64UrlEncode(bytes)}`;
    const hash = await sha256Hex(token);
    const prefix = token.slice(0, PREFIX_LENGTH);
    const createdAt = Date.now();

    this.sql`
      INSERT INTO tokens (token_hash, email, label, token_prefix, created_at)
      VALUES (${hash}, ${payload.email.trim()}, ${label}, ${prefix}, ${createdAt})
    `;

    // The plaintext token exists only in this response — it is never stored.
    return json({
      ok: true,
      token,
      info: { id: hash, label, prefix, createdAt } satisfies TokenInfo,
    });
  }

  private list(payload: Record<string, unknown>): Response {
    if (!isNonEmptyString(payload.email)) {
      return json({ ok: false, error: "email is required" }, 400);
    }

    const rows = this.sql<TokenRow>`
      SELECT token_hash, email, label, token_prefix, created_at
      FROM tokens
      WHERE email = ${payload.email.trim()}
      ORDER BY created_at DESC
    `;

    const tokens: TokenInfo[] = rows.map((row) => ({
      id: row.token_hash,
      label: row.label,
      prefix: row.token_prefix,
      createdAt: row.created_at,
    }));

    return json({ ok: true, tokens });
  }

  private revoke(payload: Record<string, unknown>): Response {
    if (!isNonEmptyString(payload.email) || !isNonEmptyString(payload.id)) {
      return json({ ok: false, error: "email and id are required" }, 400);
    }

    // Scoping by email means a forged id can only ever touch the
    // caller's own tokens.
    const existing = this.sql<{ token_hash: string }>`
      SELECT token_hash FROM tokens
      WHERE token_hash = ${payload.id} AND email = ${payload.email.trim()}
    `;
    if (existing.length === 0) {
      return json({ ok: false, error: "token not found" }, 404);
    }

    this.sql`
      DELETE FROM tokens
      WHERE token_hash = ${payload.id} AND email = ${payload.email.trim()}
    `;
    return json({ ok: true });
  }

  private rename(payload: Record<string, unknown>): Response {
    if (
      !isNonEmptyString(payload.email) ||
      !isNonEmptyString(payload.id) ||
      !isNonEmptyString(payload.label)
    ) {
      return json({ ok: false, error: "email, id and label are required" }, 400);
    }

    const existing = this.sql<{ token_hash: string }>`
      SELECT token_hash FROM tokens
      WHERE token_hash = ${payload.id} AND email = ${payload.email.trim()}
    `;
    if (existing.length === 0) {
      return json({ ok: false, error: "token not found" }, 404);
    }

    this.sql`
      UPDATE tokens SET label = ${payload.label.trim()}
      WHERE token_hash = ${payload.id} AND email = ${payload.email.trim()}
    `;
    return json({ ok: true });
  }

  /** Resolve a presented bearer token to its owner's email, or 404. */
  private async lookup(payload: Record<string, unknown>): Promise<Response> {
    if (!isNonEmptyString(payload.token)) {
      return json({ ok: false, error: "token is required" }, 400);
    }

    const hash = await sha256Hex(payload.token);
    const rows = this.sql<{ email: string }>`
      SELECT email FROM tokens WHERE token_hash = ${hash}
    `;
    if (rows.length === 0) {
      return json({ ok: false, error: "unknown token" }, 404);
    }
    return json({ ok: true, email: rows[0].email });
  }
}

export default TokenStore;
