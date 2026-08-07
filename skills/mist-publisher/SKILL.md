---
name: mist-publisher
description: Publish a document to the mist instance and return its URL. Use when the user asks to publish, share, or upload "this doc", "the summary", a markdown/txt/html file, or conversation output to mist.
compatibility: Requires curl.
version: v1.3.0
---

# mist-publisher

Publish markdown, txt, jsx, ipynb or html to the mist instance using
`/new` endpoint and return the document URL.

```
MIST_HOST=https://mist.example.instance
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
curl -s -T file.md   "$MIST_HOST/new"              # markdown
curl -s -T file.html "$MIST_HOST/new?format=html"  # html
curl -s -T file.txt  "$MIST_HOST/new?format=txt"   # plain text
curl -s -T nb.ipynb  "$MIST_HOST/new?format=ipynb" # Jupyter notebook
curl -s -T file.jsx  "$MIST_HOST/new?format=jsx"   # React component (rendered in preview)
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

```sh
curl -s "$MIST_HOST/raw/<id>" -o current.md
```

Diff it against your local copy; merge any manual edits before uploading.
The editor page `/docs/<id>` is a browser view and redirects to OneLogin for
curl — `/raw/<id>` is the read path for an agent.

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
  Comments are yours to work through — see "Resolve comments". Suggestions
  are not: accepting or rejecting them is the user's call in the UI. Never
  work around the guard.
- Content is applied per the note's current format (markdown gets frontmatter
  and threads parsed; other formats stored verbatim). Author, creation date,
  and listed state are preserved.

## 5. Resolve comments

The comments the user leaves on a note are review feedback addressed to you.
Read them, act on them, answer them, then resolve them — a comment left
unresolved keeps blocking PUT.

These routes take the bearer token:

```sh
curl -s "$MIST_HOST/docs/<id>/threads"

curl -s -X POST -H "Content-Type: application/json" \
  -d '{"text": "Fixed in the new version."}' \
  "$MIST_HOST/docs/<id>/threads/<tid>/replies"

curl -s -X POST -H "Content-Type: application/json" \
  -d '{"resolved": true}' "$MIST_HOST/docs/<id>/threads/<tid>/resolve"
```

- GET returns `{"ok":true,"threads":[…]}`, oldest first. Each thread carries
  `id`, `author`, `commentText`, `createdAt`, `resolved`, `replies[]`, plus
  `highlightText`/`anchor` for the passage it points at.
- Replies are stamped with the identity behind the token — never send an
  author field. `{"resolved": false}` reopens a thread.
- Live editors see replies and resolutions immediately.

Working through a 409 on update:

1. GET the threads; the unresolved ones are the blockers.
2. For each, apply the change the comment asks for to your local copy.
3. Reply saying what you did (or why you did not), then resolve it.
4. Retry the PUT.

Resolve only after the comment is answered — resolving is how you tell the
user the feedback landed, not a way to clear the guard. When a comment asks
for a decision that is the user's to make, reply asking for it and leave the
thread open. Deleting threads is the user's call, not yours; there is no API
for it.

## 6. Listed Documents visibility

Toggle document visibility in "Listed Documents" without touching content:

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
