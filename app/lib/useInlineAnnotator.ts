import { useEffect, useRef } from "react";
import { useDocument } from "~/lib/DocumentContext";
import {
  createAnchorKit,
  createDomAnnotator,
  type AnchorMessage,
  type AnnotatorHandle,
} from "~/lib/preview-annotator";

/**
 * Anchored comments over a same-origin preview (markdown, plain text):
 * runs the annotation engine directly on the rendered container — no
 * iframe, no postMessage — and wires it to the document's thread state.
 *
 * `contentKey` is whatever the container is rendered from; a change means
 * React replaced the DOM under the ref, so highlights repaint.
 */
export function useInlineAnnotator(
  ref: React.RefObject<HTMLElement | null>,
  contentKey: string,
) {
  const {
    threads,
    activeThreadId,
    setActiveThreadId,
    handlePreviewCommentRequest,
  } = useDocument();
  const engineRef = useRef<AnnotatorHandle | null>(null);

  // Engine per mounted container. The context callbacks are kept on a ref
  // so the engine doesn't need recreating when they change identity.
  const callbacksRef = useRef({ setActiveThreadId, handlePreviewCommentRequest });
  useEffect(() => {
    callbacksRef.current = { setActiveThreadId, handlePreviewCommentRequest };
  }, [setActiveThreadId, handlePreviewCommentRequest]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const engine = createDomAnnotator(createAnchorKit(), window, root, {
      onSelection: () => {},
      onCommentRequest: (selection) =>
        callbacksRef.current.handlePreviewCommentRequest(selection),
      onHighlightClick: (threadId) =>
        callbacksRef.current.setActiveThreadId(threadId),
    });
    engineRef.current = engine;
    return () => {
      engineRef.current = null;
      engine.destroy();
    };
  }, [ref]);

  const activeIdRef = useRef(activeThreadId);
  useEffect(() => {
    activeIdRef.current = activeThreadId;
  }, [activeThreadId]);

  // Repaint when threads or the rendered content change
  useEffect(() => {
    void contentKey;
    const anchors: AnchorMessage[] = threads
      .filter((t) => !t.resolved && t.anchor)
      .map((t) => ({ threadId: t.id, ...t.anchor! }));
    engineRef.current?.paint(anchors, activeIdRef.current);
  }, [threads, contentKey]);

  useEffect(() => {
    engineRef.current?.setActive(activeThreadId);
  }, [activeThreadId]);
}
