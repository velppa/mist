import { useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { getAgentByName } from "agents";
import type { Route } from "./+types/tokens";
import { TOKEN_STORE_AGENT_NAME } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  getSessionEmail,
  isSsoConfigured,
  type AuthEnv,
} from "~/lib/auth.server";
import type { TokenInfo } from "../../agents/tokens";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "mist — API tokens" }];
}

async function tokenStoreFetch(
  env: Env,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const store = await getAgentByName(env.TokenStore, TOKEN_STORE_AGENT_NAME);
  return store.fetch(
    new Request(`https://tokens${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const authEnv = env as AuthEnv;

  const email = await getSessionEmail(request, authEnv);
  if (!email) {
    // The worker gate normally redirects first; this guard covers the
    // SSO-off deployment and any path that bypasses the gate.
    if (isSsoConfigured(authEnv)) {
      throw redirect("/auth/login?redirect=%2Ftokens");
    }
    return { email: null, tokens: [] as TokenInfo[] };
  }

  let tokens: TokenInfo[] = [];
  try {
    const res = await tokenStoreFetch(env, "/list", { email });
    if (res.ok) {
      tokens = ((await res.json()) as { tokens: TokenInfo[] }).tokens;
    }
  } catch {
    // Render the page even if the store is unavailable.
  }

  return { email, tokens };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  const authEnv = env as AuthEnv;

  const email = await getSessionEmail(request, authEnv);
  if (!email) {
    throw new Response("authentication required", { status: 403 });
  }

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const label = String(form.get("label") ?? "").trim() || "unnamed token";
    const res = await tokenStoreFetch(env, "/create", { email, label });
    if (!res.ok) return { error: "could not create token" };
    const body = (await res.json()) as { token: string; info: TokenInfo };
    return { created: body.token, label: body.info.label };
  }

  if (intent === "revoke") {
    const id = String(form.get("id") ?? "");
    const res = await tokenStoreFetch(env, "/revoke", { email, id });
    return res.ok ? { ok: true } : { error: "could not revoke token" };
  }

  if (intent === "rename") {
    const id = String(form.get("id") ?? "");
    const label = String(form.get("label") ?? "").trim();
    if (!label) return { error: "label must not be empty" };
    const res = await tokenStoreFetch(env, "/rename", { email, id, label });
    return res.ok ? { ok: true } : { error: "could not rename token" };
  }

  return { error: "unknown action" };
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 cursor-pointer border border-border px-3 py-1 text-sm text-muted transition-colors hover:border-ink hover:text-ink"
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function TokenRow({ token }: { token: TokenInfo }) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="flex flex-wrap items-baseline gap-3 border-t border-border py-2">
      {editing ? (
        <Form
          method="post"
          className="flex min-w-0 flex-1 items-baseline gap-2"
          onSubmit={() => setEditing(false)}
        >
          <input type="hidden" name="intent" value="rename" />
          <input type="hidden" name="id" value={token.id} />
          <input
            name="label"
            defaultValue={token.label}
            autoFocus
            className="min-w-0 flex-1 border border-border bg-paper px-2 py-1 text-sm outline-none focus:border-ink"
          />
          <button
            type="submit"
            className="cursor-pointer text-sm text-muted transition-colors hover:text-ink"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="cursor-pointer text-sm text-muted transition-colors hover:text-ink"
          >
            Cancel
          </button>
        </Form>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-ink">{token.label}</span>
          <button
            onClick={() => setEditing(true)}
            className="cursor-pointer text-sm text-muted transition-colors hover:text-ink"
            aria-label={`Rename ${token.label}`}
          >
            Rename
          </button>
        </>
      )}
      <code className="shrink-0 font-mono text-sm text-muted">
        {token.prefix}&hellip;
      </code>
      <time className="shrink-0 font-mono text-sm text-muted">
        {formatDate(token.createdAt)}
      </time>
      <Form method="post">
        <input type="hidden" name="intent" value="revoke" />
        <input type="hidden" name="id" value={token.id} />
        <button
          type="submit"
          className="cursor-pointer text-sm text-coral transition-opacity hover:opacity-70"
        >
          Revoke
        </button>
      </Form>
    </li>
  );
}

export default function Tokens({ loaderData, actionData }: Route.ComponentProps) {
  const { email, tokens } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  if (!email) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="mb-4 font-mono font-light uppercase tracking-wider text-muted">
          API tokens
        </h1>
        <p className="text-muted">
          Sign-in is required to manage tokens, but SSO is not configured on
          this server.
        </p>
        <p className="mt-4">
          <Link to="/" className="text-ink transition-colors hover:text-coral">
            &larr; Home
          </Link>
        </p>
      </div>
    );
  }

  const created =
    actionData &&
    "created" in actionData &&
    typeof actionData.created === "string"
      ? { token: actionData.created, label: actionData.label }
      : null;
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="mb-8 flex items-baseline justify-between">
        <h1 className="font-mono font-light uppercase tracking-wider text-muted">
          API tokens
        </h1>
        <span className="text-sm text-muted">{email}</span>
      </div>

      <p className="mb-6 text-muted">
        Tokens authenticate programmatic uploads. Documents created with a
        token record you as the author:
      </p>
      <code className="mb-8 block overflow-x-auto whitespace-nowrap font-mono text-base">
        curl -H &quot;Authorization: Bearer &lt;token&gt;&quot;{" "}
        https://mist.findhotel.workers.dev/new -T file.md
      </code>

      <Form method="post" className="mb-4 flex items-baseline gap-2">
        <input type="hidden" name="intent" value="create" />
        <input
          name="label"
          placeholder="Label (e.g. mist.el on laptop)"
          className="min-w-0 flex-1 border border-border bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={busy}
          className="cursor-pointer whitespace-nowrap border border-ink bg-ink px-4 py-2 text-sm text-paper transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          Issue token
        </button>
      </Form>

      {error && <p className="mb-4 text-sm text-coral">{error}</p>}

      {created && (
        <div className="mb-8 border border-ink p-4">
          <p className="mb-2 text-sm text-muted">
            Token &ldquo;{created.label}&rdquo; issued. Copy it now &mdash; it
            will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm">
              {created.token}
            </code>
            <CopyButton text={created.token} />
          </div>
        </div>
      )}

      {tokens.length > 0 ? (
        <ul>
          {tokens.map((token) => (
            <TokenRow key={token.id} token={token} />
          ))}
        </ul>
      ) : (
        <p className="border-t border-border py-4 text-muted">
          No tokens yet.
        </p>
      )}

      <p className="mt-12">
        <Link to="/" className="text-ink transition-colors hover:text-coral">
          &larr; Home
        </Link>
      </p>
    </div>
  );
}
