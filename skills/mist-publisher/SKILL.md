---
name: mist-publisher
description: Publish a document to the mist instance and return its URL. Use when the user asks to publish, share, or upload "this doc", "the summary", a markdown/txt/html file, or conversation output to mist.
compatibility: Requires curl; token bootstrap needs the claude-in-chrome MCP tools.
version: v1.0.0
---

# mist-publisher

Publish markdown, txt, jsx, ipynb or html to the mist instance using `/new` endpoint and return the document URL.

```
MIST_HOST=https://mist.findhotel.workers.dev
```

## 1. Find the token

1. `$MIST_TOKEN` env var, if set.
2. Else contents of `~/.config/mist/token`.

Found → go to Publish. Missing → Bootstrap.

## 2. Bootstrap a token (once)

User has OneLogin access but no token yet.

1. Load claude-in-chrome tools via ToolSearch, then open `$MIST_HOST/tokens` in a new tab.
2. If it redirects to OneLogin: ask the user to finish logging in in the browser, wait for their confirmation, then reload `/tokens`.
3. On `/tokens`, drive the create form: enter label `mist-publisher`, submit. The plaintext token (`mist_…`) is shown once in a highlighted block — read it from the page.
4. Save it without echoing to chat:
   ```sh
   mkdir -p ~/.config/mist
   # write token via stdin/file redirection, never in argv or chat
   chmod 600 ~/.config/mist/token
   ```
5. Confirm to the user only that the token was saved.

## 3. Publish

Content not in a file yet → write it to a temp file first.

```sh
TOKEN=${MIST_TOKEN:-$(cat ~/.config/mist/token)}
curl -s -H "Authorization: Bearer $TOKEN" -T file.md  "$MIST_HOST/new"              # markdown
curl -s -H "Authorization: Bearer $TOKEN" -T file.html "$MIST_HOST/new?format=html" # html
curl -s -H "Authorization: Bearer $TOKEN" -T file.txt  "$MIST_HOST/new?format=txt"  # plain text
curl -s -H "Authorization: Bearer $TOKEN" -T nb.ipynb  "$MIST_HOST/new?format=ipynb" # Jupyter notebook
curl -s -H "Authorization: Bearer $TOKEN" -T file.jsx  "$MIST_HOST/new?format=jsx"  # React component (rendered in preview)
```

Response body = document URL. Give it to the user; offer to open it or copy it.

- 401 → token invalid or revoked: delete `~/.config/mist/token`, run Bootstrap once, retry. Still failing → show the error.
- Max upload 20 MB; binary content is rejected.
- If the body contains big blob (like base64-encoded data blob), first upload it to assets (below) and reference in the body.

### Assets

Upload images or JSON data (same auth as `/new`; `?name=` labels the file):

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: image/png" \
  --data-binary @pic.png "$MIST_HOST/assets?name=my-picture"
```

- Accepted: png, jpg, gif, webp, avif, svg, and `application/json` (for pages that
  fetch large datasets). Anything else → 415. Max 20 MB.
- Response: `/assets/<timestamp>--<name>.<ext>` — reference it relatively in the
  doc (`![alt](/assets/...)` in markdown, `fetch("/assets/...")` in html/jsx).
- Serving is public (unguessable names, immutable-cached, CORS-enabled), so
  embedded images and dataset fetches work in previews and rendered pages.
- In the mist editor, drag-and-drop or paste an image — it uploads and inserts
  the link automatically.

## 4. Update

Replace a note's content with PUT (the id may carry a title alias):

```sh
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -T file.md "$MIST_HOST/docs/<id>"
```

- 200 → response body is the canonical document URL; open editors receive the
  new content live.
- **409 Conflict** → the note has pending review state and must not be
  overwritten: unresolved comment threads (or inline comments never resolved)
  or pending suggest-mode edits. The body names the reason, e.g.
  `error: cannot update: 1 unresolved comment` / `pending suggestions`.
  Ask the user to resolve/accept them in the mist UI, then retry. Never work
  around the guard.
- Content is applied per the note's current format (markdown gets frontmatter
  and threads parsed; other formats stored verbatim). Author, creation date,
  and listed state are preserved.

Toggle homepage visibility without touching content:

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"listed": true}' "$MIST_HOST/docs/<id>/listed"
```

## Notes

- New docs are unlisted (reachable only by URL). To list one on the homepage:
  `listed: true` in frontmatter (markdown only), the DOC → Listed toggle, the
  status cell on /my, or `POST /docs/<id>/listed` (see Update).
- Ids are bare 8-char strings; URL extensions (`.md`, `.txt`, ...) and title
  aliases (`/docs/<slug>-<id>.<ext>`) are decorative. A note's format is
  switchable in the sidebar (MD / TXT / HTML / JSX / IPYNB).
- `/raw/<id>` = verbatim source with the format's Content-Type;
  `/render/<id>` = rendered HTML page for any format.
- Markdown uploads may carry frontmatter (e.g. `author`, `listed`,
  `mist.threads`); other formats are stored verbatim.
