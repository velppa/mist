import { useDocument } from "~/lib/DocumentContext";
import { DOC_FORMATS } from "~/shared/constants";

/**
 * Switch the document's format (shared, live-synced state). Changing
 * it re-renders the preview, the raw page, and the URL extension —
 * the content itself is untouched.
 */
export default function FormatToggle() {
  const { format, setFormat } = useDocument();

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm uppercase tracking-wider text-muted">
        Format
      </span>
      <div className="flex">
        {DOC_FORMATS.map((value) => (
          <button
            key={value}
            onClick={() => setFormat(value)}
            aria-pressed={format === value}
            className={`cursor-pointer border border-border px-2 py-0.5 text-sm uppercase tracking-wider transition-colors -ml-px first:ml-0 ${
              format === value
                ? "bg-ink text-paper"
                : "text-muted hover:bg-border"
            }`}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
