import { useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension, getMarkRange, type Editor as TiptapEditor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight, CriticDelimiters } from "~/lib/critic-marks";
import { markdownDecorations, cleanViewKey } from "~/lib/markdown-decorations";
import { suggestModePlugin } from "~/lib/suggest-mode";
import BubbleToolbar from "~/components/BubbleToolbar";
import type { useYjsEditor } from "~/lib/useYjsEditor";

const MarkdownDecorations = Extension.create({
  name: "markdownDecorations",
  addProseMirrorPlugins() {
    return markdownDecorations();
  },
});

const SuggestMode = Extension.create<{ docState: ReturnType<typeof useYjsEditor>["docState"] | null }>({
  name: "suggestMode",
  addOptions() {
    return { docState: null };
  },
  addProseMirrorPlugins() {
    if (!this.options.docState) return [];
    return [suggestModePlugin(this.options.docState)];
  },
});

const CommentClickHandler = Extension.create<{
  onCommentClick?: (commentText: string) => void;
}>({
  name: "commentClickHandler",
  addOptions() {
    return { onCommentClick: undefined };
  },
  addProseMirrorPlugins() {
    const onCommentClick = this.options.onCommentClick;
    if (!onCommentClick) return [];
    return [
      new Plugin({
        props: {
          handleClick(view, pos) {
            const $pos = view.state.doc.resolve(pos);
            // Use nodeAt for reliable mark detection at boundaries (inclusive:false)
            const node = view.state.doc.nodeAt(pos);
            const marks = node?.isText ? node.marks : $pos.marks();

            // Direct click on comment text (or point marker at comment boundary)
            const commentMark = marks.find((m) => m.type.name === "criticComment");
            if (commentMark) {
              if (node?.isText) {
                onCommentClick(node.text ?? "");
              }
              return true;
            }

            // Click on highlighted text → find adjacent comment
            const highlightMark = marks.find((m) => m.type.name === "criticHighlight");
            if (highlightMark) {
              const highlightType = view.state.schema.marks.criticHighlight;
              const commentType = view.state.schema.marks.criticComment;
              if (highlightType && commentType) {
                const hlRange = getMarkRange($pos, highlightType);
                if (hlRange) {
                  const $afterHl = view.state.doc.resolve(hlRange.to);
                  const cmRange = getMarkRange($afterHl, commentType);
                  if (cmRange) {
                    const text = view.state.doc.textBetween(cmRange.from, cmRange.to);
                    onCommentClick(text);
                    return true;
                  }
                }
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});

// Plugin that highlights a range while the comment input is open
const commentHighlightKey = new PluginKey("commentHighlight");

const CommentHighlight = Extension.create({
  name: "commentHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentHighlightKey,
        state: {
          init() {
            return null as { from: number; to: number } | null;
          },
          apply(tr, value) {
            const meta = tr.getMeta(commentHighlightKey);
            if (meta !== undefined) return meta;
            if (value && tr.docChanged) {
              const from = tr.mapping.map(value.from);
              const to = tr.mapping.map(value.to);
              return from < to ? { from, to } : null;
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            const range = commentHighlightKey.getState(state) as { from: number; to: number } | null;
            if (!range) return DecorationSet.empty;
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, {
                class: "comment-selection-highlight",
              }),
            ]);
          },
        },
      }),
    ];
  },
});

// Plugin that highlights the active comment thread's range in the editor
const activeCommentHighlightKey = new PluginKey("activeCommentHighlight");

const ActiveCommentHighlight = Extension.create({
  name: "activeCommentHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: activeCommentHighlightKey,
        state: {
          init() {
            return null as { from: number; to: number } | null;
          },
          apply(tr, value) {
            const meta = tr.getMeta(activeCommentHighlightKey);
            if (meta !== undefined) return meta;
            if (value && tr.docChanged) {
              const from = tr.mapping.map(value.from);
              const to = tr.mapping.map(value.to);
              return from < to ? { from, to } : null;
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            const range = activeCommentHighlightKey.getState(state) as {
              from: number;
              to: number;
            } | null;
            if (!range) return DecorationSet.empty;
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, {
                class: "cm-comment-active",
              }),
            ]);
          },
        },
      }),
    ];
  },
});

type YjsEditorState = ReturnType<typeof useYjsEditor>;

function renderCaret(user: Record<string, unknown>) {
  const cursor = document.createElement("span");
  cursor.classList.add("collaboration-cursor__caret");
  cursor.setAttribute("style", `border-color: ${user.color}`);

  const label = document.createElement("div");
  label.classList.add("collaboration-cursor__label");
  label.setAttribute("style", `background-color: ${user.color}`);
  label.insertBefore(document.createTextNode(user.name as string), null);

  cursor.insertBefore(label, null);
  return cursor;
}

/**
 * Upload dropped/pasted images to /assets and insert markdown links.
 * A unique placeholder is inserted first, then replaced when the
 * upload settles — positions may shift under collaborative editing,
 * so the replacement finds the placeholder text instead of trusting
 * the original coordinates.
 */
let uploadCounter = 0;

function insertImageUploads(view: EditorView, files: File[], pos: number | null) {
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (images.length === 0) return false;

  for (const file of images) {
    const placeholder = `![uploading-${++uploadCounter}...]()`;
    {
      const tr = view.state.tr;
      tr.insertText(placeholder, pos ?? view.state.selection.from);
      view.dispatch(tr);
    }

    const label = file.name || "image";
    void fetch(`/assets?name=${encodeURIComponent(label)}`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    })
      .then(async (res) => {
        const v = view;
        const docText = v.state.doc.textBetween(0, v.state.doc.content.size, "\n");
        const idx = docText.indexOf(placeholder);
        if (idx < 0) return; // user removed the placeholder
        // textBetween offsets shift by node boundaries; find the real
        // document range by scanning text positions.
        let from = -1;
        v.state.doc.descendants((node, nodePos) => {
          if (from >= 0 || !node.isText || !node.text) return true;
          const i = node.text.indexOf(placeholder);
          if (i >= 0) from = nodePos + i;
          return from < 0;
        });
        if (from < 0) return;
        const to = from + placeholder.length;
        const tr = v.state.tr;
        if (res.ok) {
          const assetUrl = (await res.text()).trim();
          const alt = label.replace(/\.[A-Za-z0-9]+$/, "") || "image";
          tr.replaceRangeWith(from, to, v.state.schema.text(`![${alt}](${assetUrl})`));
        } else {
          tr.delete(from, to);
        }
        v.dispatch(tr);
      })
      .catch(() => {
        // network failure: leave cleanup to the same placeholder scan
        const v = view;
        let from = -1;
        v.state.doc.descendants((node, nodePos) => {
          if (from >= 0 || !node.isText || !node.text) return true;
          const i = node.text.indexOf(placeholder);
          if (i >= 0) from = nodePos + i;
          return from < 0;
        });
        if (from >= 0) {
          v.dispatch(v.state.tr.delete(from, from + placeholder.length));
        }
      });
  }
  return true;
}

export default function Editor({
  yjs,
  hidden,
  onEditorReady,
  onCommentClick,
  commentHighlight,
  activeCommentRange,
  cleanView,
  onNewComment,
  onResolveAtCursor,
  onDeleteAtCursor,
}: {
  yjs: YjsEditorState;
  hidden?: boolean;
  onEditorReady?: (editor: TiptapEditor) => void;
  onCommentClick?: (commentText: string) => void;
  commentHighlight?: { from: number; to: number } | null;
  activeCommentRange?: { from: number; to: number } | null;
  cleanView?: boolean;
  onNewComment?: () => void;
  onResolveAtCursor?: () => void;
  onDeleteAtCursor?: () => void;
}) {
  const { doc, awareness, user, docState } = yjs;
  const prevHighlightRef = useRef<{ from: number; to: number } | null>(null);
  const prevActiveRangeRef = useRef<{ from: number; to: number } | null>(null);
  const prevCleanViewRef = useRef<boolean>(false);

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        Document,
        Paragraph,
        Text,
        CriticAddition,
        CriticDeletion,
        CriticComment,
        CriticHighlight,
        CriticDelimiters,
        Collaboration.configure({ document: doc }),
        CollaborationCaret.configure({
          provider: { awareness },
          user,
          render: renderCaret,
        }),
        MarkdownDecorations,
        SuggestMode.configure({ docState }),
        CommentClickHandler.configure({ onCommentClick }),
        CommentHighlight,
        ActiveCommentHighlight,
      ],
      editorProps: {
        attributes: {
          class: "tiptap",
        },
        handleDrop(view, event) {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (!files.some((f) => f.type.startsWith("image/"))) return false;
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          event.preventDefault();
          return insertImageUploads(view, files, coords?.pos ?? null);
        },
        handlePaste(view, event) {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!files.some((f) => f.type.startsWith("image/"))) return false;
          event.preventDefault();
          return insertImageUploads(view, files, null);
        },
      },
    },
    [doc, awareness],
  );

  // Update the comment highlight decoration when the prop changes
  useEffect(() => {
    if (!editor) return;
    const range = commentHighlight ?? null;
    const prev = prevHighlightRef.current;
    if (range?.from === prev?.from && range?.to === prev?.to) return;
    prevHighlightRef.current = range;
    const tr = editor.state.tr.setMeta(commentHighlightKey, range);
    editor.view.dispatch(tr);
  }, [editor, commentHighlight]);

  // Update the active comment highlight when the prop changes
  useEffect(() => {
    if (!editor) return;
    const range = activeCommentRange ?? null;
    const prev = prevActiveRangeRef.current;
    if (range?.from === prev?.from && range?.to === prev?.to) return;
    prevActiveRangeRef.current = range;
    const tr = editor.state.tr.setMeta(activeCommentHighlightKey, range);
    editor.view.dispatch(tr);
  }, [editor, activeCommentRange]);

  // Update clean view state when prop changes
  useEffect(() => {
    if (!editor) return;
    const isClean = cleanView ?? false;
    if (isClean === prevCleanViewRef.current) return;
    prevCleanViewRef.current = isClean;
    const tr = editor.state.tr.setMeta(cleanViewKey, isClean);
    editor.view.dispatch(tr);
  }, [editor, cleanView]);

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Focus once the doc is synced and the editor is visible, so a freshly
  // created document can be typed into immediately.
  const focusedOnceRef = useRef(false);
  useEffect(() => {
    if (!editor || hidden || !yjs.synced || focusedOnceRef.current) return;
    focusedOnceRef.current = true;
    const focusStart = () => {
      editor.commands.focus("start");
      // Tiptap's focus command can silently no-op; fall back to the DOM
      if (!editor.view.hasFocus()) editor.view.dom.focus();
    };
    focusStart();
    // The first attempt can race the ProseMirror view attaching; retry once
    const retry = window.setTimeout(() => {
      if (!editor.isDestroyed && !editor.view.hasFocus()) focusStart();
    }, 150);
    return () => window.clearTimeout(retry);
  }, [editor, hidden, yjs.synced]);

  const handleClick = useCallback(() => {
    if (editor && !editor.isFocused) {
      editor.commands.focus("end");
    }
  }, [editor]);

  if (!editor) {
    return null;
  }

  return (
    <>
      <div
        className={`min-h-full cursor-text ${hidden ? "hidden" : ""} ${cleanView ? "clean-view" : ""}`}
        onClick={handleClick}
      >
        <EditorContent editor={editor} />
      </div>
      {onNewComment && onResolveAtCursor && onDeleteAtCursor && (
        <BubbleToolbar
          editor={editor}
          onNewComment={onNewComment}
          onResolveAtCursor={onResolveAtCursor}
          onDeleteAtCursor={onDeleteAtCursor}
        />
      )}
    </>
  );
}
