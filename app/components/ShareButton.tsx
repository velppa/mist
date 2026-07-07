import { useState, useCallback } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { serializeThreads } from "~/lib/thread-serialization";
import { useDocument } from "~/lib/DocumentContext";

export default function ShareButton() {
  const { docId, markdown, threads, isPublic, togglePublic } = useDocument();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleDownload = useCallback(() => {
    const content = serializeThreads(markdown, threads);
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [docId, markdown, threads]);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex h-full cursor-pointer items-center gap-1 px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
          aria-label="Share options"
        >
          Share
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-40 border border-border bg-paper py-1"
          align="end"
          sideOffset={4}
        >
          <DropdownMenu.Item
            onSelect={handleCopy}
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
          >
            {copied ? "\u2713 Copied" : "Copy link"}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={handleDownload}
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
          >
            Download
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.CheckboxItem
            checked={isPublic}
            onCheckedChange={togglePublic}
            onSelect={(e) => e.preventDefault()}
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
          >
            {isPublic ? "Public ✓" : "Public"}
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
