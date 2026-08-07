import { useRef, useCallback, useState } from "react";
import { Link, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { getAgentByName } from "agents";
import type { Route } from "./+types/home";
import {
  APP_NAME,
  APP_VERSION,
  generateDocumentId,
  REGISTRY_AGENT_NAME,
} from "~/shared/constants";
import type { RegistryEntry } from "~/shared/types";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getSessionEmail, isSsoConfigured, type AuthEnv } from "~/lib/auth.server";
import { demoThreads } from "./demo-threads";
import { useLoaderRefresh } from "~/lib/useLoaderRefresh";
import { useCreateDoc } from "~/lib/useCreateDoc";
import ThemeSelector from "~/components/ThemeSelector";
import DocTable from "~/components/DocTable";
import UserMenu from "~/components/UserMenu";
import demoDocument from "./demo.md?raw";

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);

  const { env } = getCloudflare(context);
  const authEnv = env as AuthEnv;
  const userEmail = await getSessionEmail(request, authEnv);
  // The "My documents" tab needs an identity to scope by; with SSO off
  // the instance is single-user and every document counts as "mine".
  const myRequiresLogin = !userEmail && isSsoConfigured(authEnv);

  let documents: RegistryEntry[] = [];
  let myDocuments: RegistryEntry[] = [];
  try {
    const registry = await getAgentByName(
      env.DocumentRegistry,
      REGISTRY_AGENT_NAME,
    );
    const myRequest = userEmail
      ? new Request("https://registry/by-author", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail }),
        })
      : new Request("https://registry/all", { method: "POST" });
    const [listedRes, myRes] = await Promise.all([
      registry.fetch(new Request("https://registry/")),
      myRequiresLogin ? Promise.resolve(null) : registry.fetch(myRequest),
    ]);
    if (listedRes.ok) {
      const body = (await listedRes.json()) as { documents: RegistryEntry[] };
      documents = body.documents;
    }
    if (myRes?.ok) {
      const body = (await myRes.json()) as { documents: RegistryEntry[] };
      myDocuments = body.documents;
    }
  } catch {
    // The homepage must render even if the registry is unavailable
  }

  return { origin: url.origin, documents, myDocuments, myRequiresLogin, userEmail };
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "mist" },
    { name: "description", content: "Collaborative markdown editor" },
  ];
}

function DocTabs({ tab }: { tab: "listed" | "my" }) {
  const tabClass = (active: boolean) =>
    `border px-2.5 py-0.5 font-mono font-light text-sm uppercase tracking-wider transition-colors ${
      active
        ? "border-ink bg-ink text-paper"
        : "border-border text-muted hover:bg-border hover:text-ink"
    }`;
  return (
    <div className="mb-4 flex gap-2">
      <Link to="/" className={tabClass(tab === "listed")}>
        Listed documents
      </Link>
      <Link to="/?tab=my" className={tabClass(tab === "my")}>
        My documents
      </Link>
    </div>
  );
}

function ListedDocuments({ documents }: { documents: RegistryEntry[] }) {
  if (documents.length === 0) {
    return <p className="text-muted">No listed documents yet.</p>;
  }
  return <DocTable documents={documents} showAuthor />;
}

function MyDocuments({
  documents,
  requiresLogin,
}: {
  documents: RegistryEntry[];
  requiresLogin: boolean;
}) {
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

  if (requiresLogin) {
    return (
      <p className="text-muted">
        <a href="/auth/login?redirect=%2F%3Ftab%3Dmy" className="text-ink transition-colors hover:text-coral">
          Sign in
        </a>{" "}
        to list your documents.
      </p>
    );
  }
  if (documents.length === 0) {
    return <p className="text-muted">No documents yet.</p>;
  }
  return (
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
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { documents, myDocuments, myRequiresLogin, userEmail } = loaderData;
  // Newly public documents show up without a manual reload
  useLoaderRefresh();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "my" ? "my" : "listed";
  const { createNew, uploadFile } = useCreateDoc();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleDemoDocument() {
    const id = generateDocumentId();
    await fetch(`/agents/document-agent/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: demoDocument,
        threads: demoThreads,
        onboarding: true,
      }),
    });
    navigate(`/docs/${id}?view=edit`);
  }

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
    },
    [uploadFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && /\.(md|txt|html?|jsx|ipynb)$/i.test(file.name)) uploadFile(file);
    },
    [uploadFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <>
      <div
        className="flex min-h-screen flex-col"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <header className="flex items-stretch overflow-x-auto scrollbar-none border-b border-border">
          <span className="flex items-center bg-ink px-4 py-2 font-medium text-paper">
            {APP_NAME}
          </span>
          <div className="flex grow shrink-0 items-center px-4">
            <span className="text-muted">
              Share and preview documents, for humans and AI agents
            </span>
          </div>
          <div className="flex shrink-0 items-stretch border-l border-border">
            <button
              onClick={createNew}
              className="cursor-pointer whitespace-nowrap px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
            >
              New document
            </button>
          </div>
          <div className="flex shrink-0 items-stretch border-l border-border">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer whitespace-nowrap px-3 text-sm uppercase tracking-wider text-muted transition-colors hover:bg-border hover:text-ink"
            >
              Upload
            </button>
          </div>
          <div className="flex shrink-0 items-stretch border-l border-border">
            <button
              onClick={handleDemoDocument}
              className="cursor-pointer whitespace-nowrap px-3 text-sm uppercase tracking-wider text-muted transition-colors hover:bg-border hover:text-ink"
            >
              Demo
            </button>
          </div>
          <UserMenu userEmail={userEmail} />
          <div className="flex shrink-0 items-center border-l border-border">
            <ThemeSelector />
          </div>
        </header>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.html,.htm,.jsx,.ipynb"
          onChange={handleFileChange}
          className="hidden"
        />
        <main className="flex-1 overflow-y-auto pb-16 pt-6">
          <section className="mx-auto w-full max-w-5xl px-4">
            <DocTabs tab={tab} />
            {tab === "listed" ? (
              <ListedDocuments documents={documents} />
            ) : (
              <MyDocuments
                documents={myDocuments}
                requiresLogin={myRequiresLogin}
              />
            )}
          </section>
        </main>
      </div>
      <footer className="fixed bottom-0 left-0 right-0 z-10 flex items-baseline justify-between border-t border-border bg-paper px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-base text-muted">
        <span>
          Bugs and feedback on{" "}
          <a
            href="https://github.com/velppa/mist"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink transition-colors hover:text-coral"
          >
            velppa/mist
          </a>
          .
        </span>
        <span className="flex items-baseline gap-4">
          <a
            href="/docs/mist-changelog-2impzerh.md"
            className="font-mono font-light uppercase tracking-wider text-muted transition-colors hover:text-coral"
          >
            v{APP_VERSION}
          </a>
          <span className="font-mono font-light uppercase tracking-wider text-ink">
            MIT licensed
          </span>
        </span>
      </footer>
    </>
  );
}
