import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router";
import { getMarkRange, type Editor as TiptapEditor } from "@tiptap/core";
import { parseViewMode, applyViewMode } from "~/lib/view-mode";
import type { DocFormat } from "~/shared/constants";
import type { CapturedSelection, DocMode } from "~/shared/types";
import type { MatchedThread } from "~/lib/comment-threads";
import type { useYjsEditor } from "~/lib/useYjsEditor";
import { useThreads } from "~/lib/useThreads";
import { findCommentTextAtCursor } from "~/lib/comment-threads";
import { serializeWithCriticMarkup } from "~/lib/critic-serializer";

export type DocWidth = "full" | "120" | "65";
const DOC_WIDTHS: DocWidth[] = ["full", "120", "65"];

export interface DocumentContextValue {
  docId: string;
  // Canonical id decorated with the title slug and the live format
  // extension, for user-facing links
  aliasId: string;
  // Live document format (shared state, switchable)
  format: DocFormat;
  setFormat: (f: DocFormat) => void;
  createdAt: number | null;
  // Signed-in user's email, null when anonymous / SSO off
  userEmail: string | null;
  yjs: ReturnType<typeof useYjsEditor>;
  editorInstance: TiptapEditor | null;
  markdown: string;

  // Mode
  mode: DocMode;
  toggleMode: () => void;

  // Preview
  showPreview: boolean;
  togglePreview: () => void;
  setPreviewHeld: (held: boolean) => void;

  // Clean view
  cleanView: boolean;
  toggleCleanView: () => void;

  // Layout: doc-area column width
  docWidth: DocWidth;
  setDocWidth: (w: DocWidth) => void;

  // Visibility — listed documents appear on the homepage
  isListed: boolean;
  toggleListed: () => void;

  // Comments
  commentActive: boolean;
  commentSelection: CapturedSelection | null;
  commentHighlight: { from: number; to: number } | null;
  openCommentInput: () => void;
  handleCommentActiveChange: (active: boolean) => void;
  activateComment: (commentText: string) => void;
  handleResolveAtCursor: () => void;
  handleDeleteAtCursor: () => void;

  // Threads
  threads: MatchedThread[];
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  activeCommentRange: { from: number; to: number } | null;
  addReply: (threadId: string, text: string) => void;
  resolveThread: (threadId: string) => void;
  deleteThread: (threadId: string) => void;

  // Onboarding
  isOnboarding: boolean;
  clearDocument: () => void;

  // Editor lifecycle
  handleEditorReady: (editor: TiptapEditor) => void;
  handleCommentClick: (commentText: string) => void;
}

// Named _DocumentContext so test helpers can provide mock values directly
export const _DocumentContext = createContext<DocumentContextValue | null>(null);

export function useDocument(): DocumentContextValue {
  const ctx = useContext(_DocumentContext);
  if (!ctx) {
    throw new Error("useDocument must be used within a DocumentProvider");
  }
  return ctx;
}

export function DocumentProvider({
  docId,
  aliasBase,
  createdAt,
  userEmail = null,
  yjs,
  children,
}: {
  docId: string;
  /** Slugged id without extension; the live format appends one. */
  aliasBase?: string;
  createdAt: number | null;
  userEmail?: string | null;
  yjs: ReturnType<typeof useYjsEditor>;
  children: React.ReactNode;
}) {
  const [markdown, setMarkdown] = useState("");
  const [editorInstance, setEditorInstance] = useState<TiptapEditor | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [previewHeld, setPreviewHeld] = useState(false);
  const [commentActive, setCommentActive] = useState(false);
  const [commentSelection, setCommentSelection] = useState<CapturedSelection | null>(null);
  const [commentHighlight, setCommentHighlight] = useState<{ from: number; to: number } | null>(null);
  const [cleanView, setCleanView] = useState(true);
  // Per-user preference, remembered across documents. SSR renders the
  // default; the stored value is applied after mount so hydration matches.
  const [docWidth, setDocWidthState] = useState<DocWidth>("120");
  useEffect(() => {
    const stored = localStorage.getItem("mist-doc-width") as DocWidth | null;
    if (stored && DOC_WIDTHS.includes(stored)) setDocWidthState(stored); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  // The toggled view lives in the URL (?view=edit / preview by default) so
  // links are shareable; the transient "hold to peek" state stays local.
  const previewToggled = parseViewMode(searchParams) === "preview";
  const showPreview = previewToggled || previewHeld;

  const {
    threads,
    activateComment,
    addReply,
    resolveThread,
    deleteThread,
    activeThreadId,
    setActiveThreadId,
    suppressSelectionRef,
  } = useThreads({ doc: yjs.doc, editor: editorInstance, user: yjs.user });

  const toggleMode = useCallback(() => {
    yjs.setMode(yjs.mode === "edit" ? "suggest" : "edit");
  }, [yjs]);

  const togglePreview = useCallback(() => {
    setSearchParams(
      (prev) =>
        applyViewMode(
          prev,
          parseViewMode(prev) === "preview" ? "edit" : "preview",
        ),
      { replace: true, preventScrollReset: true },
    );
  }, [setSearchParams]);

  const toggleCleanView = useCallback(() => {
    setCleanView((v) => !v);
  }, []);

  const setDocWidth = useCallback((w: DocWidth) => {
    localStorage.setItem("mist-doc-width", w);
    setDocWidthState(w);
  }, []);

  const toggleListed = useCallback(() => {
    yjs.setListed(!yjs.isListed);
  }, [yjs]);

  const handleEditorReady = useCallback((editor: TiptapEditor) => {
    setEditorInstance(editor);
    const update = () => setMarkdown(serializeWithCriticMarkup(editor.state.doc));
    update();
    editor.on("update", update);
  }, []);

  const handleCommentClick = useCallback(
    (commentText: string) => {
      const match = threads.find((t) => t.commentText === commentText);
      if (match) {
        suppressSelectionRef.current = true;
        setActiveThreadId(activeThreadId === match.id ? null : match.id);
      }
    },
    [threads, activeThreadId, setActiveThreadId, suppressSelectionRef],
  );

  const openCommentInput = useCallback(() => {
    if (editorInstance) {
      const { from, to, empty } = editorInstance.state.selection;
      if (!empty) {
        const text = editorInstance.state.doc.textBetween(from, to);
        setCommentSelection({ from, to, text });
        setCommentHighlight({ from, to });
      } else {
        setCommentSelection(null);
        setCommentHighlight(null);
      }
    }
    setCommentActive(true);
  }, [editorInstance]);

  const handleCommentActiveChange = useCallback(
    (active: boolean) => {
      if (active) {
        openCommentInput();
      } else {
        setCommentActive(false);
        setCommentSelection(null);
        setCommentHighlight(null);
      }
    },
    [openCommentInput],
  );

  const clearDocument = useCallback(() => {
    if (!editorInstance) return;
    // Content first: document marks are the ground truth for threads, so
    // marks must be gone before the map is emptied — otherwise reconcile
    // re-creates thread entries from the still-present inline marks.
    editorInstance.commands.clearContent();
    yjs.doc.transact(() => {
      const threadsMap = yjs.doc.getMap<string>("threads");
      const keys = Array.from(threadsMap.keys());
      for (const key of keys) threadsMap.delete(key);
      yjs.docState.delete("onboarding");
      yjs.docState.set("mode", "edit");
    });
    // Reset local UI state
    setCommentActive(false);
    setCommentSelection(null);
    setCommentHighlight(null);
  }, [editorInstance, yjs]);

  const handleResolveAtCursor = useCallback(() => {
    if (!editorInstance) return;
    const text = findCommentTextAtCursor(editorInstance);
    if (!text) return;
    const match = threads.find((t) => t.commentText === text);
    if (match) resolveThread(match.id);
  }, [editorInstance, threads, resolveThread]);

  const handleDeleteAtCursor = useCallback(() => {
    if (!editorInstance) return;
    const text = findCommentTextAtCursor(editorInstance);
    if (!text) return;
    const match = threads.find((t) => t.commentText === text);
    if (match) deleteThread(match.id);
  }, [editorInstance, threads, deleteThread]);

  const activeCommentRange = useMemo(() => {
    if (!activeThreadId) return null;
    const thread = threads.find((t) => t.id === activeThreadId);
    if (!thread?.position || !thread.endPosition) return null;

    let from = thread.position;
    const to = thread.endPosition;

    // Expand range to include preceding highlight if present
    if (editorInstance && thread.highlightText && from > 0) {
      const highlightType = editorInstance.schema.marks.criticHighlight;
      if (highlightType) {
        const $pos = editorInstance.state.doc.resolve(from - 1);
        const hlRange = getMarkRange($pos, highlightType);
        if (hlRange && hlRange.to === from) {
          from = hlRange.from;
        }
      }
    }

    return { from, to };
  }, [activeThreadId, threads, editorInstance]);

  const value: DocumentContextValue = {
    docId,
    aliasId: `${aliasBase ?? docId}.${yjs.format}`,
    format: yjs.format,
    setFormat: yjs.setFormat,
    createdAt,
    userEmail,
    yjs,
    editorInstance,
    markdown,
    mode: yjs.mode,
    toggleMode,
    showPreview,
    togglePreview,
    setPreviewHeld,
    cleanView,
    toggleCleanView,
    docWidth,
    setDocWidth,
    isListed: yjs.isListed,
    toggleListed,
    commentActive,
    commentSelection,
    commentHighlight,
    openCommentInput,
    handleCommentActiveChange,
    activateComment,
    handleResolveAtCursor,
    handleDeleteAtCursor,
    threads,
    activeThreadId,
    setActiveThreadId,
    activeCommentRange,
    addReply,
    resolveThread,
    deleteThread,
    isOnboarding: yjs.isOnboarding,
    clearDocument,
    handleEditorReady,
    handleCommentClick,
  };

  return (
    <_DocumentContext.Provider value={value}>
      {children}
    </_DocumentContext.Provider>
  );
}
