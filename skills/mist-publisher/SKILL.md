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

# Update an existing doc (rejected with 409 while it has unresolved comments or pending suggestions):
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -T file.md "$MIST_HOST/docs/<id>"
```

Response body = document URL. Give it to the user; offer to open it or copy it.

- 401 → token invalid or revoked: delete `~/.config/mist/token`, run Bootstrap once, retry. Still failing → show the error.
- Max upload 20 MB; binary content is rejected.

## Notes

- New docs are unlisted (reachable only by URL). To put one on the homepage: `listed: true` in frontmatter (markdown only) or the doc's DOC → Listed toggle.
- Markdown uploads may carry frontmatter (`author`, `listed`, `mist.threads`); txt/html are stored verbatim.
