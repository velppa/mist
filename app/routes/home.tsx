import { useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { getAgentByName } from "agents";
import type { Route } from "./+types/home";
import {
  APP_NAME,
  generateDocumentId,
  REGISTRY_AGENT_NAME,
} from "~/shared/constants";
import type { RegistryEntry } from "~/shared/types";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getSessionEmail, type AuthEnv } from "~/lib/auth.server";
import { deserializeThreads } from "~/lib/thread-serialization";
import { useLoaderRefresh } from "~/lib/useLoaderRefresh";
import ThemeSelector from "~/components/ThemeSelector";
import DocTable from "~/components/DocTable";
import UserMenu from "~/components/UserMenu";
import demoDocument from "./demo.md?raw";

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);

  const { env } = getCloudflare(context);
  const userEmail = await getSessionEmail(request, env as AuthEnv);

  let documents: RegistryEntry[] = [];
  try {
    const registry = await getAgentByName(
      env.DocumentRegistry,
      REGISTRY_AGENT_NAME,
    );
    const res = await registry.fetch(new Request("https://registry/"));
    if (res.ok) {
      const body = (await res.json()) as { documents: RegistryEntry[] };
      documents = body.documents;
    }
  } catch {
    // The homepage must render even if the registry is unavailable
  }

  return { origin: url.origin, documents, userEmail };
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "mist" },
    { name: "description", content: "Collaborative markdown editor" },
  ];
}

function RecentDocuments({ documents }: { documents: RegistryEntry[] }) {
  if (documents.length === 0) {
    return (
      <p className="mx-auto w-full max-w-5xl px-4 text-muted">
        No listed documents yet.
      </p>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4">
      <h2 className="mb-2 font-mono font-light uppercase tracking-wider text-muted">
        Recent documents
      </h2>
      <DocTable documents={documents} showAuthor />
    </section>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { documents, userEmail } = loaderData;
  // Newly public documents show up without a manual reload
  useLoaderRefresh();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  async function handleNewDocument() {
    const id = generateDocumentId();
    await fetch(`/agents/document-agent/${id}`, { method: "POST" });
    // Creators land in edit mode; shared links open in preview by default
    navigate(`/docs/${id}?view=edit`);
  }

  async function handleDemoDocument() {
    const { body, threads, onboarding } = deserializeThreads(demoDocument);
    const id = generateDocumentId();
    await fetch(`/agents/document-agent/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body, threads, onboarding }),
    });
    navigate(`/docs/${id}?view=edit`);
  }

  const handleUpload = useCallback(
    async (file: File) => {
      const text = await file.text();
      // File extension decides the note format; frontmatter/threads are
      // a markdown concept.
      const ext = file.name.match(/\.(txt|html?)$/i)?.[1]?.toLowerCase();
      const suffix = ext === "txt" ? ".txt" : ext ? ".html" : "";
      const id = generateDocumentId() + suffix;
      const payload = suffix
        ? { content: text }
        : (() => {
            const { body, threads } = deserializeThreads(text);
            return { content: body, threads };
          })();

      await fetch(`/agents/document-agent/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      navigate(`/docs/${id}?view=edit`);
    },
    [navigate],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
    },
    [handleUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && /\.(md|txt|html?)$/i.test(file.name)) handleUpload(file);
    },
    [handleUpload],
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
              Share and edit Markdown together, quickly
            </span>
          </div>
          <div className="flex shrink-0 items-stretch border-l border-border">
            <button
              onClick={handleNewDocument}
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
              Upload .md
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
          accept=".md,.txt,.html,.htm"
          onChange={handleFileChange}
          className="hidden"
        />
        <main className="flex-1 overflow-y-auto pb-16 pt-6">
          <RecentDocuments documents={documents} />
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
        <span className="font-mono font-light uppercase tracking-wider text-ink">
          MIT licensed
        </span>
      </footer>
    </>
  );
}
