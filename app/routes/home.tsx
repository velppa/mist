import { useRef, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router";
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
import ThemeSelector from "~/components/ThemeSelector";
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

function formatDate(timestamp: number): string {
  // Fixed ISO date keeps server and client renders identical
  return new Date(timestamp).toISOString().slice(0, 10);
}

function RecentDocuments({ documents }: { documents: RegistryEntry[] }) {
  if (documents.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-2xl px-4 pb-16">
      <h2 className="mb-2 font-mono font-light uppercase tracking-wider text-muted">
        Recent documents
      </h2>
      <ul>
        {documents.map((doc) => (
          <li
            key={doc.id}
            className="flex items-baseline gap-4 border-t border-border py-2"
          >
            <Link
              to={`/docs/${doc.id}`}
              className="min-w-0 flex-1 truncate text-ink transition-colors hover:text-coral"
            >
              {doc.title}
            </Link>
            {doc.author && (
              <span className="shrink-0 truncate text-muted">{doc.author}</span>
            )}
            <time
              dateTime={new Date(doc.updatedAt).toISOString()}
              className="shrink-0 font-mono text-base text-muted"
            >
              {formatDate(doc.updatedAt)}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { origin, documents } = loaderData;
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const curlCommand = `curl ${origin}/new -T file.md`;

  function handleCopy() {
    navigator.clipboard.writeText(curlCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleNewDocument() {
    const { body, threads, onboarding } = deserializeThreads(demoDocument);
    const id = generateDocumentId();
    await fetch(`/agents/document-agent/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body, threads, onboarding }),
    });
    // Creators land in edit mode; shared links open in preview by default
    navigate(`/docs/${id}?view=edit`);
  }

  const handleUpload = useCallback(
    async (file: File) => {
      const text = await file.text();
      const { body, threads } = deserializeThreads(text);
      const id = generateDocumentId();

      // Create the document with initial content + threads via POST body
      await fetch(`/agents/document-agent/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body, threads }),
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
      if (file && file.name.endsWith(".md")) handleUpload(file);
    },
    [handleUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <>
      <div
        className={`relative flex flex-col items-center justify-center px-4 ${
          documents.length > 0 ? "min-h-[70vh]" : "min-h-screen"
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className="absolute right-3 top-3">
          <ThemeSelector />
        </div>
        <h1 className="mb-1 font-bold">{APP_NAME}</h1>
        <p className="mb-8 text-muted">
          Share and edit Markdown together, quickly
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={handleNewDocument}
            className="cursor-pointer whitespace-nowrap border border-ink bg-ink px-6 py-2 text-paper transition-opacity hover:opacity-80"
          >
            New document
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer whitespace-nowrap border border-border px-6 py-2 text-muted transition-colors hover:border-ink hover:text-ink"
          >
            Drag and drop .md file
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md"
          onChange={handleFileChange}
          className="hidden"
        />
        <p className="mt-8 text-muted">Or from your terminal</p>
        <div className="mt-2 flex max-w-full items-center gap-1.5">
          <code className="flex min-w-0 items-center overflow-x-auto font-mono text-base">
            <span className="md-delimiter shrink-0">`</span>
            <span className="md-code whitespace-nowrap">{curlCommand}</span>
            <span className="md-delimiter shrink-0">`</span>
          </code>
          <button
            onClick={handleCopy}
            className="shrink-0 cursor-pointer p-1 text-muted hover:text-ink transition-colors"
            aria-label={copied ? "Copied" : "Copy command"}
          >
            {copied ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <RecentDocuments documents={documents} />
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
