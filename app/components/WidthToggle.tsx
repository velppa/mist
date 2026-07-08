import { useDocument } from "~/lib/DocumentContext";
import type { DocWidth } from "~/lib/DocumentContext";

const options: { value: DocWidth; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "120", label: "120" },
  { value: "65", label: "65" },
];

export default function WidthToggle() {
  const { docWidth, setDocWidth } = useDocument();

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm uppercase tracking-wider text-muted">Width</span>
      <div className="flex">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setDocWidth(opt.value)}
            aria-pressed={docWidth === opt.value}
            className={`cursor-pointer border border-border px-2.5 py-0.5 text-sm uppercase tracking-wider transition-colors -ml-px first:ml-0 ${
              docWidth === opt.value
                ? "bg-ink text-paper"
                : "text-muted hover:bg-border"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
