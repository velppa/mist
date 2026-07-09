import { useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import ThreadPanel from "~/components/ThreadPanel";

export default function ThreadList() {
  const {
    threads,
    activeThreadId,
    setActiveThreadId: onSelectThread,
    addReply: onReply,
    resolveThread: onResolve,
    deleteThread: onDelete,
    openCommentInput: onNewComment,
    editorInstance,
  } = useDocument();

  const [showResolved, setShowResolved] = useState(false);

  const openThreads = threads.filter((t) => !t.resolved);
  const resolvedThreads = threads.filter((t) => t.resolved);
  const visibleThreads = showResolved ? threads : openThreads;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm uppercase tracking-wider text-muted">
          Comments ({openThreads.length})
        </span>
        {editorInstance && (
          <button
            onClick={onNewComment}
            className="cursor-pointer bg-canary px-2 py-0.5 text-sm font-medium uppercase tracking-wider text-[#1a1a1a] transition-opacity hover:opacity-85"
            aria-label="New comment"
          >
            + Add
          </button>
        )}
      </div>

      {visibleThreads.length === 0 && !showResolved && (
        <div className="px-3 py-6 text-center text-muted">
          No comments yet
        </div>
      )}

      {visibleThreads.map((thread) => (
        <div key={thread.id} className="border-b border-border">
          <ThreadPanel
            thread={thread}
            active={activeThreadId === thread.id}
            onSelect={onSelectThread}
            onReply={onReply}
            onResolve={onResolve}
            onDelete={onDelete}
          />
        </div>
      ))}

      {resolvedThreads.length > 0 && (
        <button
          onClick={() => setShowResolved((v) => !v)}
          className="cursor-pointer px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-border"
        >
          {showResolved
            ? "Hide resolved"
            : `Show resolved (${resolvedThreads.length})`}
        </button>
      )}
    </div>
  );
}
