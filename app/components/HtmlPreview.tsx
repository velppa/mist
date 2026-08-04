import { useEffect, useMemo, useRef, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { stripCriticMarkup } from "~/lib/critic-parser";
import { buildAnnotatorScript, type AnchorMessage } from "~/lib/preview-annotator";
import type { ThreadAnchor } from "~/shared/types";

/**
 * The HTML preview with comment support. The document renders in a
 * sandboxed iframe (opaque origin — the note's scripts stay away from the
 * viewer's cookies), with the annotator script injected into the srcdoc.
 * Anchored threads are sent in for highlighting; selections come back as
 * text-quote anchors and open the comment composer.
 */
export default function HtmlPreview() {
  const {
    markdown,
    threads,
    activeThreadId,
    setActiveThreadId,
    handlePreviewCommentRequest,
  } = useDocument();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [annotatorReady, setAnnotatorReady] = useState(false);

  const srcDoc = useMemo(
    () => stripCriticMarkup(markdown) + buildAnnotatorScript(),
    [markdown],
  );

  // A new srcdoc reloads the iframe and discards the annotator with it
  useEffect(() => {
    setAnnotatorReady(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [srcDoc]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { type?: string } | null;
      if (!data || typeof data !== "object") return;

      if (data.type === "mist-annotator-ready") {
        setAnnotatorReady(true);
      } else if (data.type === "mist-comment-request") {
        const anchor = (data as { selection?: ThreadAnchor }).selection;
        if (anchor?.quote) handlePreviewCommentRequest(anchor);
      } else if (data.type === "mist-highlight-click") {
        const threadId = (data as { threadId?: string }).threadId;
        if (threadId) setActiveThreadId(threadId);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [handlePreviewCommentRequest, setActiveThreadId]);

  // Paint unresolved anchored threads when they change; active-thread
  // changes only toggle classes (and scroll), so they go separately.
  const activeIdRef = useRef(activeThreadId);
  useEffect(() => {
    activeIdRef.current = activeThreadId;
  }, [activeThreadId]);
  useEffect(() => {
    if (!annotatorReady) return;
    const anchors: AnchorMessage[] = threads
      .filter((t) => !t.resolved && t.anchor)
      .map((t) => ({ threadId: t.id, ...t.anchor! }));
    iframeRef.current?.contentWindow?.postMessage(
      { type: "mist-anchors", anchors, activeThreadId: activeIdRef.current },
      "*",
    );
  }, [annotatorReady, threads]);

  useEffect(() => {
    if (!annotatorReady) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "mist-active", activeThreadId },
      "*",
    );
  }, [annotatorReady, activeThreadId]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      className="h-full w-full border-0"
      title="preview"
    />
  );
}
