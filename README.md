# TabMesh

> One backend connection, every browser tab. SharedWorker-primary event mesh with elected-leader fallback.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Status: pre-1.0](https://img.shields.io/badge/status-pre--1.0-orange.svg)](https://tabmesh.dev/roadmap)
[![Docs](https://img.shields.io/badge/docs-tabmesh.dev-646cff.svg)](https://tabmesh.dev)

Open the same web app in three tabs and you'll typically see three independent WebSockets, three copies of the same push notification, three idle reconnect storms when the network blips. TabMesh collapses that to **one** WebSocket shared by all tabs, an IndexedDB-backed outbox so closing a tab doesn't drop events, and real-time event delivery between tabs.

```bash
pnpm install @tabmesh/core @tabmesh/transport-websocket
```

```ts
import { TabMesh } from '@tabmesh/core';
import { WebSocketTransport } from '@tabmesh/transport-websocket';

const mesh = new TabMesh({
  channelName: 'my-app',
  transport: new WebSocketTransport({ url: 'wss://api.example.com' }),
  workerVersion: process.env.GIT_SHA,
});

await mesh.start();
mesh.on('chat.message', (event) => console.log(event.payload, event.source));
await mesh.send({ type: 'chat.message', payload: { text: 'Hello' } });
```

Plus a one-time copy of the SharedWorker bundle into your app's `public/` directory — [docs walk through it](https://tabmesh.dev/guide/getting-started).

## Documentation

→ **[tabmesh.dev](https://tabmesh.dev)** — full docs, recipes, API reference
→ [Quickstart](https://tabmesh.dev/guide/getting-started) — install through first cross-tab event
→ [Gotchas](https://tabmesh.dev/guide/gotchas) — **read this before adopting in production**
→ [Architecture](https://tabmesh.dev/guide/architecture) — SharedWorker primary, elected-leader fallback, outbox
→ [Playground](https://tabmesh.dev/playground) — live multi-tab demo
→ [Roadmap](https://tabmesh.dev/roadmap) — what's next, considered, out of scope

## Status

Pre-1.0. The core API works and is exercised by 122 unit tests and an 11-test Playwright harness, but:

- API may change before 1.0 in response to real-world feedback.
- `delivered` semantics will tighten when `ackMode: 'server'` lands.
- SSE / long-poll transports and Vue / Svelte adapters are roadmap, not shipped.

If you're trying TabMesh and hit a sharp edge, [open an issue](https://github.com/CodeThicket/tabmesh/issues/new). The shape of those issues is what 1.0 needs to settle.

## Development

```bash
pnpm install
pnpm test          # vitest, ~120 unit tests
pnpm test:e2e      # playwright (requires `pnpm exec playwright install chromium` once)
pnpm typecheck
pnpm biome:check
pnpm docs:dev      # local docs site
```

→ [`CONTEXT.md`](CONTEXT.md) — domain language and design notes
→ [`docs/adr/`](docs/adr/) — architecture decisions, served publicly at [tabmesh.dev/adr](https://tabmesh.dev/adr)

## License

MIT © TabMesh Contributors
