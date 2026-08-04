---
name: mist-publisher
description: Publish a document to the mist instance and return its URL. Use when the user asks to publish, share, or upload "this doc", "the summary", a markdown/txt/html file, or conversation output to mist.
compatibility: Requires curl.
version: v1.2.0
---

# mist-publisher

Publish markdown, txt, jsx, ipynb or html to the mist instance using
`/new` endpoint and return the document URL.

```
MIST_HOST=https://mist.findhotel.workers.dev
```

## 1. Authorization

In Claude's remote environments auth token is injected
automatically when admin configured Mist via Access Bundle.  Use
curl directly.

Otherwise, find the token:
1. `$MIST_TOKEN` env var, if set.
2. Else contents of `~/.config/mist/token`.

When token used, all requests with `curl` should add `-H "Authorization: Bearer $TOKEN"` header.

Found → go to "Publish". Missing → go to "Bootstrap a token".

## 2. Bootstrap a token

User has OneLogin access but no token yet.

1. Load claude-in-chrome tools via ToolSearch. If claude-in-chrome not
  available, ask user to `$MIST_HOST/tokens`, generate a token and
  save it to `~/.config/mist/token` file.
2. Open `$MIST_HOST/tokens` in a new tab.
3. If it redirects to OneLogin: ask the user to finish logging in in
   the browser, wait for their confirmation, then reload `/tokens`.
4. On `/tokens`, drive the create form: enter label `mist-publisher`,
   submit. The plaintext token (`mist_…`) is shown once in a
   highlighted block — read it from the page.
5. Save it without echoing to chat:
   ```sh
   mkdir -p ~/.config/mist
   # write token via stdin/file redirection, never in argv or chat
   chmod 600 ~/.config/mist/token
   ```
6. Confirm to the user only that the token was saved.

## 3. Publish

Content not in a file yet → write it to a temp file first.

```sh
TOKEN=${MIST_TOKEN:-$(cat ~/.config/mist/token)}
curl -s -T file.md  "$MIST_HOST/new"              # markdown
curl -s -T file.html "$MIST_HOST/new?format=html" # html
curl -s -T file.txt  "$MIST_HOST/new?format=txt"  # plain text
curl -s -T nb.ipynb  "$MIST_HOST/new?format=ipynb" # Jupyter notebook
curl -s -T file.jsx  "$MIST_HOST/new?format=jsx"  # React component (rendered in preview)
```

Response body = document URL. Give it to the user; offer to open it or copy it.

- 401 → token invalid or revoked: delete `~/.config/mist/token`, run Bootstrap once, retry. Still failing → show the error.
- Max upload 20 MB; binary content is rejected.
- If the body contains big blob (like base64-encoded data blob), first upload it to assets (below) and reference in the body.

### Assets

Upload images or JSON data (same auth as `/new`; `?name=` labels the file):

```sh
curl -s -X POST -H "Content-Type: image/png" \
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

**PUT replaces the whole note — always download the current version first**
and apply your changes on top of it. The user may have edited the note in the
mist editor since you last uploaded; PUTting a stale local copy silently wipes
those edits. Never PUT a file you generated earlier in the session without
re-fetching.

Reads are NOT token-authenticated: GET `/raw/<id>` (and GET `/docs/<id>`)
require a OneLogin browser session and redirect (302) when hit with curl +
bearer token. To download the current version:

1. Fetch `$MIST_HOST/raw/<id>` via the claude-in-chrome tools (user's browser
   has the session), or
2. Ask the user to paste/save the current content.

Diff it against your local copy; merge any manual edits before uploading.

Replace a note's content with PUT (the id may carry a title alias):

```sh
curl -s -X PUT -T file.md "$MIST_HOST/docs/<id>"
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
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"listed": true}' "$MIST_HOST/docs/<id>/listed"
```

## Notes

- New docs are unlisted (reachable only by URL). To list one on the homepage:
  `listed: true` in frontmatter (markdown only), the DOC → Listed toggle, the
  status cell on "My documents" tab, or `POST /docs/<id>/listed` (see Update).
- Ids are bare 8-char strings; URL extensions (`.md`, `.txt`, ...) and title
  aliases (`/docs/<slug>-<id>.<ext>`) are decorative. A note's format is
  switchable in the sidebar (MD / TXT / HTML / JSX / IPYNB).
- `/raw/<id>` = verbatim source with the format's Content-Type;
  `/render/<id>` = rendered HTML page for any format.
- Markdown uploads may carry frontmatter (e.g. `author`, `listed`,
  `mist.threads`); other formats are stored verbatim.
