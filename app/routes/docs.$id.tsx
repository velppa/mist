import { useState, useCallback, useEffect, useRef } from "react";
import { data, Link } from "react-router";
import type { Route } from "./+types/docs.$id";
import { getAgentByName } from "agents";
import { docAliasId, effectiveFormat, parseDocId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getSessionEmail, type AuthEnv } from "~/lib/auth.server";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
import { useCreateDoc } from "~/lib/useCreateDoc";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import PreviewToggle from "~/components/PreviewToggle";
import ConnectionStatus from "~/components/ConnectionStatus";
import ShareButton from "~/components/ShareButton";
import UserMenu from "~/components/UserMenu";
import ModeToggle from "~/components/ModeToggle";
import WidthToggle from "~/components/WidthToggle";
import FormatToggle from "~/components/FormatToggle";
import CleanViewToggle from "~/components/CleanViewToggle";
import SuggestionActions from "~/components/SuggestionActions";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import ThemeSelector from "~/components/ThemeSelector";
import MobilePanel from "~/components/MobilePanel";
import OnboardingBanner from "~/components/OnboardingBanner";

export function meta({ data }: Route.MetaArgs) {
  // Same fallback as the registry: untitled docs go by their id
  const title = data?.title ?? data?.id;
  return [{ title: title ? `${title} | mist` : "mist" }];
}

export async function loader({ params, context, request }: Route.LoaderArgs) {
  // The path param may carry a decorative title alias; the trailing
  // id segment is authoritative.
  const id = parseDocId(params.id);
  if (!id) {
    throw data(null, { status: 404 });
  }

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request("https://do/"));
  const { exists, createdAt, author, title, format } = (await res.json()) as {
    exists: boolean;
    createdAt: number | null;
    author?: string | null;
    title?: string | null;
    format?: string;
  };

  if (!exists) {
    throw data(null, { status: 404 });
  }

  // Signed-in identity: used as awareness name and comment author.
  const userEmail = await getSessionEmail(request, env as AuthEnv);

  return {
    id,
    createdAt,
    author: author ?? null,
    title: title ?? null,
    format: effectiveFormat(format),
    userEmail,
  };
}

export default function DocumentPage({ loaderData }: Route.ComponentProps) {
  // Remount everything per document: the Yjs doc/provider are created
  // once per mount, so an in-app navigation to another doc must not
  // reuse them (the old state would replay into the new document).
  return <DocumentView key={loaderData.id} loaderData={loaderData} />;
}

function DocumentView({ loaderData }: { loaderData: Route.ComponentProps["loaderData"] }) {
  const { id, createdAt, title, format, userEmail } = loaderData;
  const yjs = useYjsEditor(id, userEmail, format);

  return (
    <DocumentProvider
      docId={id}
      aliasBase={docAliasId(id, title)}
      createdAt={createdAt}
      userEmail={userEmail}
      yjs={yjs}
    >
      <DocumentLayout />
    </DocumentProvider>
  );
}

function DocumentLayout() {
  const {
    yjs,
    showPreview,
    handleEditorReady,
    handleCommentClick,
    commentHighlight,
    activeCommentRange,
    cleanView,
    openCommentInput,
    handleResolveAtCursor,
    handleDeleteAtCursor,
    mode,
    userEmail,
    docWidth,
    aliasId,
    format,
  } = useDocument();
  // Non-markdown notes are source text; edit them in the same
  // monospace face the preview and raw views use.
  const monoDoc = format !== "md";
  const [copiedUrl, setCopiedUrl] = useState(false);
  const { createNew, uploadFile } = useCreateDoc();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The editor is expensive on large documents, so it mounts only when
  // editing starts; once mounted it stays (preview peeks keep state).
  const [editorWanted, setEditorWanted] = useState(!showPreview);
  useEffect(() => {
    if (!showPreview) setEditorWanted(true); // eslint-disable-line react-hooks/set-state-in-effect
  }, [showPreview]);

  const handleCopyUrl = useCallback(async () => {
    await navigator.clipboard.writeText(
      `${window.location.origin}/docs/${aliasId}`,
    );
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }, [aliasId]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-stretch overflow-x-auto scrollbar-none border-b border-border">
        <Link
          to="/"
          className="flex items-center bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
        >
          mist
        </Link>
        <div className="flex grow shrink-0 items-center gap-3 px-4">
          <span className="font-mono font-bold">{aliasId}</span>
          <a
            href={`/render/${aliasId}`}
            className="border border-border px-2.5 py-0.5 text-sm uppercase tracking-wider text-ink transition-colors hover:bg-ink hover:text-paper"
          >
            render
          </a>
          <a
            href={`/raw/${aliasId}`}
            className="border border-border px-2.5 py-0.5 text-sm uppercase tracking-wider text-ink transition-colors hover:bg-ink hover:text-paper"
          >
            raw
          </a>
          <button
            onClick={handleCopyUrl}
            className="cursor-pointer whitespace-nowrap border border-border px-2.5 py-0.5 text-sm uppercase tracking-wider text-ink transition-colors hover:bg-ink hover:text-paper"
          >
            {copiedUrl ? "copied" : "copy url"}
          </button>
        </div>
        <div className="flex shrink-0 items-stretch border-l border-border">
          <button
            onClick={() => void createNew()}
            className="cursor-pointer whitespace-nowrap px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
          >
            New
          </button>
        </div>
        <div className="flex shrink-0 items-stretch border-l border-border">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer whitespace-nowrap px-3 text-sm uppercase tracking-wider text-muted transition-colors hover:bg-border hover:text-ink"
          >
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,.html,.htm,.jsx,.ipynb"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
            }}
            className="hidden"
          />
        </div>
        <div className="flex shrink-0 items-center border-l border-border px-3">
          <ConnectionStatus />
        </div>
        <UserMenu userEmail={userEmail} />
        <div className="shrink-0 border-l border-border">
          <ShareButton />
        </div>
        <div className="flex shrink-0 items-center border-l border-border">
          <ThemeSelector />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto pb-[33vh] lg:border-r lg:border-border lg:pb-0">
          <div
            className={`${monoDoc ? "font-mono" : ""} ${
              docWidth === "full"
                ? ""
                : `mx-auto ${docWidth === "120" ? "max-w-[120ch]" : "max-w-[65ch]"}`
            }`}
          >
            {editorWanted && (
              <Editor
                yjs={yjs}
                hidden={showPreview}
                onEditorReady={handleEditorReady}
                onCommentClick={handleCommentClick}
                commentHighlight={commentHighlight}
                activeCommentRange={activeCommentRange}
                cleanView={cleanView}
                onNewComment={openCommentInput}
                onResolveAtCursor={handleResolveAtCursor}
                onDeleteAtCursor={handleDeleteAtCursor}
              />
            )}
            {showPreview && <Preview />}
          </div>
        </main>
        <aside className="hidden w-96 flex-col overflow-hidden lg:flex">
          <div className="flex-1 overflow-y-auto">
            <OnboardingBanner />
            <WidthToggle />
            <FormatToggle />
            <ModeToggle />
            <SuggestionActions />
            {mode === "suggest" && <CleanViewToggle />}
            <div className="border-t border-border" />
            <CommentInput />
            <ThreadList />
          </div>
          <div className="shrink-0 border-t border-border">
            <PreviewToggle />
          </div>
        </aside>
      </div>
      <MobilePanel className="lg:hidden" />
    </div>
  );
}
