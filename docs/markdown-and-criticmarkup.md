# Markdown and CriticMarkup

How mist stores, imports, and exports document content.

## Goal

All content lives in a single Markdown file: the document text, formatting, suggested edits, comments, and thread metadata. The file is the canonical format. Success means **round-tripping with no loss**: download a document, upload it again, download it again — the two downloads are identical.

## Markdown

mist documents are plain Markdown. The underlying text retains the Markdown characters (`**bold**`, `# heading`, etc.) rather than converting to rich-text nodes. The Markdown you type is the Markdown you get back on download.

### Limitations

These are editor limitations that prevent perfect round-tripping in some cases:

- The editor is paragraph-based. Each line is an independent paragraph. There is no concept of nested block structures (e.g. a list item containing a blockquote) — these render correctly in preview but are flat paragraphs in the editor.
- No support for tables, footnotes, or extended Markdown syntax.

## CriticMarkup

Suggested edits use [CriticMarkup](https://criticmarkup.com/), a plain-text convention for tracking changes in Markdown files. mist supports four of the five CriticMarkup types.

### Supported syntax

| Type | Syntax | Example |
|------|--------|---------|
| Addition | `{++ ++}` | `{++new text++}` |
| Deletion | `{-- --}` | `{--removed text--}` |
| Comment | `{>> <<}` | `{>>This needs a citation<<}` |
| Highlight | `{== ==}` | `{==highlighted passage==}` |

### Not supported

| Type | Syntax | Alternative |
|------|--------|-------------|
| Substitution | `{~~old~>new~~}` | Use `{--old--}{++new++}` |

Importing a file with substitution syntax returns a 400 error with a message explaining the alternative.

### Suggest mode

When suggest mode is active, typing and deleting produce CriticMarkup instead of direct edits:

- **Typing new text** inserts it as an addition (`{++new text++}`).
- **Deleting text** marks it as a deletion (`{--deleted text--}`) — the text remains visible but struck through.
- **Deleting inside an existing addition** removes the added text normally (shrinks the addition).
- **Deleting already-deleted text** is a no-op.

Mode syncs across all connected clients.

### Highlight + comment pairing

A highlight can be paired with a comment to annotate a specific passage:

```
{==highlighted text==}{>>This is the comment about the highlighted text<<}
```

On import, this is split into two adjacent ranges: a highlight and a comment. The comment links to a thread (see below) while the highlight marks the passage being discussed.

### Accept and reject

Each suggestion (addition or deletion) can be accepted or rejected:

- **Accept addition**: the addition markers are removed, text stays.
- **Reject addition**: the text is removed.
- **Accept deletion**: the text is removed.
- **Reject deletion**: the deletion markers are removed, text stays.

### Limitations

- **Multi-paragraph CriticMarkup** is not supported. Each line is parsed independently, so a deletion that spans two paragraphs should be two separate deletions.
- **Precedence on export**: if text has multiple CriticMarkup types (which shouldn't normally happen), the serializer uses the first match in order: addition > deletion > comment > highlight.

## Comments and threads

Threads live in the document agent, not in the text. They are reached
through the thread API (`GET /docs/:id/threads`, and the reply/resolve
routes) and through the sidebar; nothing about them is written into the
markdown.

An inline comment still leaves its CriticMarkup in the body — a highlight
plus a comment, as above — and the thread that carries the conversation is
matched to it by the comment text.

### Standalone comments

A comment without a highlight appears as a point marker in the document:

```
Some text{>>A note about this point in the document<<} continues here.
```

## The body is stored verbatim

An uploaded body is stored exactly as sent. mist reads no metadata out of
it and writes none back into it: a leading `---` block is content like any
other line, and `GET /raw/:id` returns what was uploaded, byte for byte.

Downloading from the editor gives the current text the same way.

## Import edge cases

- **Substitution syntax** is rejected on import — it must be manually converted to `{--old--}{++new++}` before uploading.

## References

- [CriticMarkup spec](https://criticmarkup.com/)
- [`critic-markup` npm package](https://www.npmjs.com/package/critic-markup)
