import { data, Link } from "react-router";
import type { Route } from "./+types/docs.$id";
import { getAgentByName } from "agents";
import { isValidDocumentId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import { getSessionEmail, type AuthEnv } from "~/lib/auth.server";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import PreviewToggle from "~/components/PreviewToggle";
import ConnectionStatus from "~/components/ConnectionStatus";
import ShareButton from "~/components/ShareButton";
import UserMenu from "~/components/UserMenu";
import ModeToggle from "~/components/ModeToggle";
import WidthToggle from "~/components/WidthToggle";
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
  const id = params.id;
  if (!isValidDocumentId(id)) {
    throw data(null, { status: 404 });
  }

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request("https://do/"));
  const { exists, createdAt, author, title } = (await res.json()) as {
    exists: boolean;
    createdAt: number | null;
    author?: string | null;
    title?: string | null;
  };

  if (!exists) {
    throw data(null, { status: 404 });
  }

  // Signed-in identity: used as awareness name and comment author.
  const userEmail = await getSessionEmail(request, env as AuthEnv);

  return { id, createdAt, author: author ?? null, title: title ?? null, userEmail };
}

export default function DocumentPage({ loaderData }: Route.ComponentProps) {
  const { id, createdAt, userEmail } = loaderData;
  const yjs = useYjsEditor(id, userEmail);

  return (
    <DocumentProvider docId={id} createdAt={createdAt} userEmail={userEmail} yjs={yjs}>
      <DocumentLayout id={id} />
    </DocumentProvider>
  );
}

function DocumentLayout({ id }: { id: string }) {
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
  } = useDocument();

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
          <span className="font-mono font-bold">{id}</span>
          <a
            href={`/raw/${id}`}
            className="border border-border px-2.5 py-0.5 text-sm uppercase tracking-wider text-ink transition-colors hover:bg-ink hover:text-paper"
          >
            raw
          </a>
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
            className={
              docWidth === "full"
                ? undefined
                : `mx-auto ${docWidth === "120" ? "max-w-[120ch]" : "max-w-[65ch]"}`
            }
          >
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
            {showPreview && <Preview />}
          </div>
        </main>
        <aside className="hidden w-96 flex-col overflow-hidden lg:flex">
          <div className="flex-1 overflow-y-auto">
            <OnboardingBanner />
            <WidthToggle />
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
