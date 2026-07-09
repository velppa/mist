import { useState } from "react";
import { Link, redirect, useRevalidator } from "react-router";
import { getAgentByName } from "agents";
import type { Route } from "./+types/my";
import { REGISTRY_AGENT_NAME } from "~/shared/constants";
import type { RegistryEntry } from "~/shared/types";
import { getCloudflare } from "~/lib/cloudflare.server";
import DocTable from "~/components/DocTable";
import {
  getSessionEmail,
  isSsoConfigured,
  type AuthEnv,
} from "~/lib/auth.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "mist — my documents" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const authEnv = env as AuthEnv;

  const email = await getSessionEmail(request, authEnv);
  if (!email) {
    // The worker gate normally redirects first; this guard covers the
    // SSO-off deployment and any path that bypasses the gate.
    if (isSsoConfigured(authEnv)) {
      throw redirect("/auth/login?redirect=%2Fmy");
    }
    return { email: null, documents: [] as RegistryEntry[] };
  }

  let documents: RegistryEntry[] = [];
  try {
    const registry = await getAgentByName(
      env.DocumentRegistry,
      REGISTRY_AGENT_NAME,
    );
    const res = await registry.fetch(
      new Request("https://registry/by-author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    );
    if (res.ok) {
      documents = ((await res.json()) as { documents: RegistryEntry[] })
        .documents;
    }
  } catch {
    // Render the page even if the registry is unavailable.
  }

  return { email, documents };
}

export default function MyDocs({ loaderData }: Route.ComponentProps) {
  const { email, documents } = loaderData;
  // Two-step delete: first click arms the row, second click deletes
  const [armedId, setArmedId] = useState<string | null>(null);
  const revalidator = useRevalidator();
  const [pendingListedId, setPendingListedId] = useState<string | null>(null);

  async function handleToggleListed(doc: RegistryEntry) {
    if (pendingListedId) return;
    setPendingListedId(doc.id);
    try {
      const res = await fetch(`/docs/${doc.id}/listed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listed: !doc.listed }),
      });
      if (!res.ok) throw new Error(`listed toggle failed: ${res.status}`);
      revalidator.revalidate();
    } catch {
      // leave the row as-is; the next revalidation shows the truth
    } finally {
      setPendingListedId(null);
    }
  }

  async function handleDelete(id: string) {
    if (armedId !== id) {
      setArmedId(id);
      return;
    }
    setArmedId(null);
    await fetch(`/agents/document-agent/${id}`, { method: "DELETE" });
    revalidator.revalidate();
  }

  if (!email) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <h1 className="mb-4 font-mono font-light uppercase tracking-wider text-muted">
          My documents
        </h1>
        <p className="text-muted">
          Sign-in is required to list your documents, but SSO is not
          configured on this server.
        </p>
        <p className="mt-4">
          <Link to="/" className="text-ink transition-colors hover:text-coral">
            &larr; Home
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <p className="mb-4">
        <Link to="/" className="text-ink transition-colors hover:text-coral">
          &larr; Home
        </Link>
      </p>
      <div className="mb-8 flex items-baseline justify-between">
        <h1 className="font-mono font-light uppercase tracking-wider text-muted">
          My documents
        </h1>
        <span className="text-sm text-muted">{email}</span>
      </div>

      {documents.length > 0 ? (
        <DocTable
          documents={documents}
          showListed
          onToggleListed={handleToggleListed}
          pendingListedId={pendingListedId}
          renderActions={(doc) => (
            <button
              onClick={() => void handleDelete(doc.id)}
              onBlur={() => setArmedId((v) => (v === doc.id ? null : v))}
              className="cursor-pointer font-mono text-sm uppercase tracking-wider text-coral transition-colors hover:bg-border"
            >
              {armedId === doc.id ? "Confirm?" : "Delete"}
            </button>
          )}
        />
      ) : (
        <p className="border-t border-border py-4 text-muted">
          No documents yet. Documents you create appear here after their
          first sync.
        </p>
      )}

    </div>
  );
}
