# mist

Collaborative markdown editor. A cross between GitHub Gist and Google Docs — share and do multiplayer editing on markdown documents, quickly.

Everything is public by URL. Documents persist live with no save button. Multiple users see each other's cursors in real time.

## Features

- **Real-time multiplayer editing** via TipTap + Yjs, backed by Cloudflare Durable Objects
- **Live markdown formatting** — inline styles render as you type, with formatting characters shown in grey
- **Suggest mode** — track changes using CriticMarkup (additions, deletions, comments, highlights)
- **Threaded comments** with highlight anchoring
- **Preview mode** — rendered markdown with click, hover, or keypress toggle
- **CLI upload** — `curl https://your-domain/new -T file.md`
- **Drag and drop** `.md` files to create new documents
- **Dark/light/auto themes**

## Tech stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Durable Objects](https://developers.cloudflare.com/durable-objects/) (backend + persistence)
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) (real-time WebSocket agent)
- [React Router 7](https://reactrouter.com/) (SSR)
- [TipTap 3](https://tiptap.dev/) (editor)
- [Yjs](https://yjs.dev/) (CRDT for multiplayer)
- [Tailwind CSS 4](https://tailwindcss.com/) (styling)
- TypeScript, Vitest

## Getting started

### Prerequisites

- Node.js 22+ (see `.nvmrc`)
- A Cloudflare account (free tier works)

### Setup

```bash
git clone https://github.com/inanimate-tech/mist.git
cd mist
npm install
```

### Development

```bash
npm run dev
```

### Deploy

Set your Cloudflare account ID via environment variable:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
npm run deploy
```

### Optional: Analytics

To enable [Fathom](https://usefathom.com/) analytics, set these environment variables (or add to `.dev.vars`):

```
VITE_FATHOM_SITE_ID=your-site-id
VITE_FATHOM_DOMAINS=your-domain.com
```

### Commands

```bash
npm run dev          # Local development server
npm run build        # Production build
npm run deploy       # Build and deploy to Cloudflare Workers
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
npm run test         # Vitest with coverage
npm run test:watch   # Vitest in watch mode
```

## Project structure

```
agents/       Durable Object agents (server-side document state)
app/
  components/ UI components
  lib/        Editor logic, utilities, CriticMarkup, Yjs provider
  routes/     File-based routing
  shared/     Types and constants shared between client and server
workers/      Cloudflare Worker entry point
tests/        Test suite
```

## Licence

[MIT](LICENSE)
