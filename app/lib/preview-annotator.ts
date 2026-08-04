/**
 * Text-quote anchoring and comment capture for the HTML preview.
 *
 * The anchoring model follows Redline (https://github.com/umangjaipuria/redline,
 * MIT, Copyright (c) 2026 Umang Jaipuria): an anchor stores the normalized
 * quote plus surrounding context and position hints, and is re-resolved
 * against the rendered text on every paint — no persisted position can go
 * stale-and-wrong.
 *
 * The preview iframe is sandboxed without allow-same-origin, so the parent
 * cannot touch its DOM. Instead a self-contained script is injected into the
 * srcdoc (`buildAnnotatorScript`) and the two sides talk over postMessage:
 *
 *   iframe → parent: mist-annotator-ready, mist-selection,
 *                    mist-comment-request, mist-highlight-click
 *   parent → iframe: mist-anchors, mist-active
 *
 * Everything the script needs is bundled through Function.prototype.toString,
 * so the helpers below must stay free of imports and module-level references.
 */

import type { ThreadAnchor } from "~/shared/types";

interface TextRange {
  start: number;
  end: number;
}

export interface AnchorKit {
  MAX_QUOTE_LENGTH: number;
  CONTEXT_WINDOW: number;
  normalizeQuote(quote: string): string;
  normalizeQuoteKey(quote: string): string;
  normalizeWithOffsets(text: string): { normalized: string; offsets: number[] };
  findQuoteMatches(text: string, quote: string): TextRange[];
  contextScore(text: string, match: TextRange, prefix: string, suffix: string): number;
  chooseMatch(text: string, anchor: ThreadAnchor): TextRange | null;
  captureSelectors(text: string, range: TextRange): ThreadAnchor;
}

/**
 * The shared text-normalization contract: whitespace collapsed to single
 * spaces, matched case-insensitively, ranges reported over the original text.
 * Selection capture and highlight painting both go through it, so anchors
 * captured on one render resolve on any other.
 */
export function createAnchorKit(): AnchorKit {
  const MAX_QUOTE_LENGTH = 500;
  const CONTEXT_WINDOW = 32;

  function normalizeQuote(quote: string): string {
    return String(quote ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_QUOTE_LENGTH);
  }

  function normalizeQuoteKey(quote: string): string {
    return normalizeQuote(quote).toLowerCase();
  }

  // Whitespace-collapsed, lowercased copy of `text` plus a per-character map
  // back to original indices; a trailing entry maps a match end to the index
  // just past the matched run.
  function normalizeWithOffsets(text: string): { normalized: string; offsets: number[] } {
    let normalized = "";
    const offsets: number[] = [];
    let inWhitespace = false;
    const source = String(text ?? "");
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index] ?? "";
      if (/\s/.test(char)) {
        if (inWhitespace) continue;
        inWhitespace = true;
        normalized += " ";
        offsets.push(index);
        continue;
      }
      inWhitespace = false;
      for (const lowerChar of char.toLowerCase()) {
        normalized += lowerChar;
        offsets.push(index);
      }
    }
    offsets.push(source.length);
    return { normalized, offsets };
  }

  // Every whitespace-/case-insensitive match of `quote`, as ranges over the
  // original text, in document order.
  function findQuoteMatches(text: string, quote: string): TextRange[] {
    const needle = normalizeQuoteKey(quote);
    if (!needle) return [];
    const { normalized, offsets } = normalizeWithOffsets(String(text ?? ""));
    const matches: TextRange[] = [];
    let from = 0;
    while (from <= normalized.length) {
      const at = normalized.indexOf(needle, from);
      if (at === -1) break;
      const start = offsets[at];
      const end = offsets[at + needle.length];
      if (start !== undefined && end !== undefined && end > start) {
        matches.push({ start, end });
      }
      from = at + Math.max(needle.length, 1);
    }
    return matches;
  }

  // How well the text around `match` agrees with the stored prefix/suffix:
  // 0, 1, or 2 boundary hits.
  function contextScore(text: string, match: TextRange, prefix: string, suffix: string): number {
    const before = normalizeQuoteKey(text.slice(Math.max(0, match.start - CONTEXT_WINDOW * 2), match.start));
    const after = normalizeQuoteKey(text.slice(match.end, match.end + CONTEXT_WINDOW * 2));
    const p = normalizeQuoteKey(prefix);
    const s = normalizeQuoteKey(suffix);
    let score = 0;
    if (p && before.endsWith(p.slice(-CONTEXT_WINDOW))) score += 1;
    if (s && after.startsWith(s.slice(0, CONTEXT_WINDOW))) score += 1;
    return score;
  }

  // Resolve an anchor to a concrete range: exact quote matches only,
  // disambiguated by context first, then by proximity to the position hint.
  // A genuinely ambiguous anchor stays unpainted rather than guessed.
  function chooseMatch(text: string, anchor: ThreadAnchor): TextRange | null {
    const matches = findQuoteMatches(text, anchor.quote);
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    let bestScore = -Infinity;
    const top: TextRange[] = [];
    for (const match of matches) {
      const score = contextScore(text, match, anchor.prefix, anchor.suffix);
      if (score > bestScore) {
        bestScore = score;
        top.length = 0;
        top.push(match);
      } else if (score === bestScore) {
        top.push(match);
      }
    }
    if (top.length === 1 && bestScore > 0) return top[0];

    const pool = top.length > 0 ? top : matches;
    const target = anchor.posStart;
    let minDist = Infinity;
    for (const m of pool) minDist = Math.min(minDist, Math.abs(m.start - target));
    const nearest = pool.filter((m) => Math.abs(m.start - target) === minDist);
    return nearest.length === 1 ? nearest[0] : null;
  }

  function captureSelectors(text: string, range: TextRange): ThreadAnchor {
    return {
      quote: normalizeQuote(text.slice(range.start, range.end)),
      prefix: normalizeQuote(text.slice(Math.max(0, range.start - CONTEXT_WINDOW), range.start)),
      suffix: normalizeQuote(text.slice(range.end, range.end + CONTEXT_WINDOW)),
      posStart: range.start,
      posEnd: range.end,
    };
  }

  return {
    MAX_QUOTE_LENGTH,
    CONTEXT_WINDOW,
    normalizeQuote,
    normalizeQuoteKey,
    normalizeWithOffsets,
    findQuoteMatches,
    contextScore,
    chooseMatch,
    captureSelectors,
  };
}

export interface AnchorMessage {
  threadId: string;
  quote: string;
  prefix: string;
  suffix: string;
  posStart: number;
  posEnd: number;
}

/**
 * The in-iframe side: builds a text index over the rendered document, captures
 * selections as quote selectors, paints highlight spans for resolved anchors,
 * and relays clicks — all over postMessage to the (cross-origin) parent.
 */
export function installMistAnnotator(kit: AnchorKit): void {
  interface CharRef {
    node: Text;
    offset: number;
  }
  interface TextIndex {
    text: string;
    chars: CharRef[];
    nodeStart: Map<Text, number>;
  }

  const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIV", "DL",
    "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2",
    "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P",
    "PRE", "SECTION", "TABLE", "TD", "TH", "TR", "UL", "BR",
  ]);

  let index: TextIndex | null = null;
  let currentSelection: ReturnType<typeof captureSelection> = null;
  let lastAnchors: AnchorMessage[] = [];
  let lastActiveId: string | null = null;

  const style = document.createElement("style");
  style.setAttribute("data-mist-annotator", "");
  style.textContent = [
    ".mist-highlight { background: rgba(255, 137, 106, 0.25); border-bottom: 2px solid rgba(255, 137, 106, 0.7); cursor: pointer; border-radius: 2px; }",
    ".mist-highlight.active { background: rgba(255, 137, 106, 0.5); }",
    "#mist-comment-btn { position: absolute; z-index: 2147483647; padding: 4px 10px; font: 12px/1.6 system-ui, sans-serif; letter-spacing: 0.05em; text-transform: uppercase; color: #fff; background: #1a1a1a; border: none; border-radius: 3px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.25); }",
    "#mist-comment-btn:hover { background: #444; }",
  ].join("\n");
  (document.head || document.documentElement).appendChild(style);

  const button = document.createElement("button");
  button.id = "mist-comment-btn";
  button.type = "button";
  button.textContent = "Comment";
  button.style.display = "none";
  button.setAttribute("data-mist-annotator", "");

  function post(message: Record<string, unknown>): void {
    window.parent.postMessage(message, "*");
  }

  function isExcludedText(node: Text): boolean {
    let current = node.parentElement;
    while (current) {
      if (current.tagName === "SCRIPT" || current.tagName === "STYLE") return true;
      if (current.hasAttribute("data-mist-annotator")) return true;
      current = current.parentElement;
    }
    return false;
  }

  function nearestBlock(node: Node): Element | null {
    let current = node.parentElement;
    while (current) {
      if (BLOCK_TAGS.has(current.tagName)) return current;
      current = current.parentElement;
    }
    return null;
  }

  // The canonical text layer: document order, script/style/annotator UI
  // excluded, a synthetic space at block boundaries.
  function buildIndex(): TextIndex {
    const chars: CharRef[] = [];
    const nodeStart = new Map<Text, number>();
    let text = "";
    let lastBlock: Element | null = null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (candidate) =>
        isExcludedText(candidate as Text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let node = walker.nextNode() as Text | null;
    while (node) {
      const block = nearestBlock(node);
      if (text.length > 0 && block !== lastBlock && !/\s$/.test(text)) {
        text += " ";
        chars.push({ node, offset: 0 }); // synthetic; never a match boundary
      }
      lastBlock = block;
      nodeStart.set(node, text.length);
      const data = node.data;
      for (let i = 0; i < data.length; i += 1) {
        text += data[i];
        chars.push({ node, offset: i });
      }
      node = walker.nextNode() as Text | null;
    }
    index = { text, chars, nodeStart };
    return index;
  }

  function indexOfNode(idx: TextIndex, container: Node, offset: number): number | null {
    if (container.nodeType === Node.TEXT_NODE) {
      const base = idx.nodeStart.get(container as Text);
      return base === undefined ? null : base + offset;
    }
    const child = container.childNodes[offset] ?? container.childNodes[offset - 1];
    if (child && child.nodeType === Node.TEXT_NODE) {
      return idx.nodeStart.get(child as Text) ?? null;
    }
    let found: Text | null = null;
    (function firstText(node: Node) {
      if (found) return;
      if (node.nodeType === Node.TEXT_NODE) {
        found = node as Text;
        return;
      }
      for (let i = 0; i < node.childNodes.length; i += 1) firstText(node.childNodes[i]);
    })(container);
    return found ? (idx.nodeStart.get(found) ?? null) : null;
  }

  function captureSelection(): (ThreadAnchor & { rectBottom: number; rectRight: number }) | null {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const idx = index ?? buildIndex();
    const range = selection.getRangeAt(0);
    const posStart = indexOfNode(idx, range.startContainer, range.startOffset);
    const posEnd = indexOfNode(idx, range.endContainer, range.endOffset);
    if (posStart === null || posEnd === null || posEnd <= posStart) return null;
    const selectors = kit.captureSelectors(idx.text, { start: posStart, end: posEnd });
    if (!selectors.quote) return null;
    const rects = range.getClientRects();
    const last = rects[rects.length - 1];
    return {
      ...selectors,
      rectBottom: last ? last.bottom + window.scrollY : window.scrollY,
      rectRight: last ? last.right + window.scrollX : window.scrollX,
    };
  }

  function clearHighlights(): void {
    const spans = document.querySelectorAll("span.mist-highlight[data-thread-id]");
    for (let i = 0; i < spans.length; i += 1) {
      const el = spans[i];
      const parent = el.parentNode;
      if (!parent) continue;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
    document.body.normalize();
  }

  function rangeFor(idx: TextIndex, start: number, end: number): Range | null {
    const startRef = idx.chars[start];
    const endRef = idx.chars[end - 1];
    if (!startRef || !endRef) return null;
    const range = document.createRange();
    range.setStart(startRef.node, startRef.offset);
    range.setEnd(endRef.node, endRef.offset + 1);
    return range;
  }

  // Wrap a (possibly multi-node) range in per-text-node highlight spans,
  // splitting boundary nodes so only matched characters are wrapped.
  function wrapRange(range: Range, threadId: string, active: boolean): void {
    const container = range.commonAncestorContainer;
    const root =
      container.nodeType === Node.TEXT_NODE ? (container.parentNode ?? container) : container;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node = walker.nextNode() as Text | null;
    while (node) {
      if (range.intersectsNode(node)) nodes.push(node);
      node = walker.nextNode() as Text | null;
    }
    for (const target of nodes) {
      const start = target === range.startContainer ? range.startOffset : 0;
      const end = target === range.endContainer ? range.endOffset : target.length;
      if (start >= end) continue;
      let piece = target;
      if (start > 0) piece = piece.splitText(start);
      if (end - start < piece.length) piece.splitText(end - start);
      const span = document.createElement("span");
      span.className = "mist-highlight" + (active ? " active" : "");
      span.setAttribute("data-thread-id", threadId);
      piece.parentNode?.insertBefore(span, piece);
      span.appendChild(piece);
    }
  }

  // Resolve all anchors against a fresh index, then wrap back-to-front so
  // node splits never invalidate lower offsets.
  function paint(anchors: AnchorMessage[], activeId: string | null): void {
    lastAnchors = anchors;
    lastActiveId = activeId;
    clearHighlights();
    const idx = buildIndex();
    const planned: { range: Range; threadId: string; start: number }[] = [];
    for (const anchor of anchors) {
      const match = kit.chooseMatch(idx.text, anchor);
      if (!match) continue;
      const range = rangeFor(idx, match.start, match.end);
      if (range) planned.push({ range, threadId: anchor.threadId, start: match.start });
    }
    planned.sort((a, b) => b.start - a.start);
    for (const item of planned) {
      wrapRange(item.range, item.threadId, item.threadId === activeId);
    }
    buildIndex();
  }

  function setActive(activeId: string | null): void {
    lastActiveId = activeId;
    const spans = document.querySelectorAll(".mist-highlight[data-thread-id]");
    let scrolled = false;
    for (let i = 0; i < spans.length; i += 1) {
      const el = spans[i];
      const isActive = el.getAttribute("data-thread-id") === activeId;
      el.classList.toggle("active", isActive);
      if (isActive && !scrolled) {
        scrolled = true;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }

  function hideButton(): void {
    button.style.display = "none";
  }

  function onSelectionSettled(): void {
    currentSelection = captureSelection();
    if (currentSelection) {
      button.style.left = Math.max(0, currentSelection.rectRight - 40) + "px";
      button.style.top = currentSelection.rectBottom + 6 + "px";
      button.style.display = "block";
    } else {
      hideButton();
    }
    post({
      type: "mist-selection",
      selection: currentSelection && {
        quote: currentSelection.quote,
        prefix: currentSelection.prefix,
        suffix: currentSelection.suffix,
        posStart: currentSelection.posStart,
        posEnd: currentSelection.posEnd,
      },
    });
  }

  button.addEventListener("mousedown", (event) => {
    // Before mouseup collapses the selection
    event.preventDefault();
    event.stopPropagation();
    if (!currentSelection) return;
    post({
      type: "mist-comment-request",
      selection: {
        quote: currentSelection.quote,
        prefix: currentSelection.prefix,
        suffix: currentSelection.suffix,
        posStart: currentSelection.posStart,
        posEnd: currentSelection.posEnd,
      },
    });
    hideButton();
    document.getSelection()?.removeAllRanges();
  });

  let selectionTimer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener("selectionchange", () => {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(onSelectionSettled, 200);
  });

  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const highlight = target && typeof target.closest === "function"
      ? target.closest(".mist-highlight[data-thread-id]")
      : null;
    if (highlight) {
      post({ type: "mist-highlight-click", threadId: highlight.getAttribute("data-thread-id") });
    }
  });

  window.addEventListener("message", (event: MessageEvent) => {
    // Only the embedding page may drive painting
    if (event.source !== window.parent) return;
    const data = event.data as { type?: string } | null;
    if (!data || typeof data !== "object") return;
    if (data.type === "mist-anchors") {
      const msg = data as { anchors?: AnchorMessage[]; activeThreadId?: string | null };
      paint(Array.isArray(msg.anchors) ? msg.anchors : [], msg.activeThreadId ?? null);
    } else if (data.type === "mist-active") {
      const msg = data as { activeThreadId?: string | null };
      setActive(msg.activeThreadId ?? null);
    }
  });

  function start(): void {
    document.body.appendChild(button);
    buildIndex();
    post({ type: "mist-annotator-ready" });
    // Late layout (images, fonts) shifts nothing text-wise, but a repaint
    // after load keeps highlight geometry honest for click targets.
    window.addEventListener("load", () => {
      if (lastAnchors.length > 0) paint(lastAnchors, lastActiveId);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
}

/**
 * The script tag injected into the preview srcdoc. Serialized from the real
 * functions above so the injected code never drifts from the tested code.
 */
export function buildAnnotatorScript(): string {
  return `<script>(${installMistAnnotator.toString()})((${createAnchorKit.toString()})());</script>`;
}
