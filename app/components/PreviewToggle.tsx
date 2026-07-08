import { useEffect, useCallback } from "react";
import { useSearchParams } from "react-router";
import { useDocument } from "~/lib/DocumentContext";
import { parseViewMode } from "~/lib/view-mode";

function Spinner() {
  return (
    <svg
      className="mr-1.5 h-3 w-3 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function PreviewToggle() {
  const { showPreview: active, togglePreview: onToggle, setPreviewHeld: onHold, yjs } = useDocument();
  const synced = yjs.synced;
  // Label states the action; it follows the URL mode, not the transient peek
  const [searchParams] = useSearchParams();
  const previewMode = parseViewMode(searchParams) === "preview";

  // P key hold: show preview while held (only when editor not focused)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "p" && e.key !== "P") return;
      if (e.repeat) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).closest(".tiptap")) return;
      onHold(true);
    },
    [onHold],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "p" && e.key !== "P") return;
      onHold(false);
    },
    [onHold],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return (
    <button
      onClick={onToggle}
      className={`flex h-24 w-full cursor-pointer items-center justify-center text-sm uppercase tracking-wider transition-colors ${
        active
          ? "bg-ink text-paper"
          : "text-muted hover:bg-border"
      }`}
    >
      {!synced && !active && <Spinner />}
      {previewMode ? "Edit" : "Preview"}
    </button>
  );
}
