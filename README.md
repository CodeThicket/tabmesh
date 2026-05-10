# TabMesh

> One backend connection, every browser tab. SharedWorker-primary event mesh with elected-leader fallback.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Status: pre-1.0](https://img.shields.io/badge/status-pre--1.0-orange.svg)](#status)

TabMesh multiplexes a single backend transport (WebSocket today, SSE / long-poll later) across all browser tabs of the same origin, persists outbound events to IndexedDB so a closing tab doesn't drop them, and gives every tab a real-time view of the others.

## What it solves

Open the same web app in three tabs and you'll typically see three independent WebSockets, three copies of the same push notification, three idle reconnect storms when the network blips. TabMesh collapses that to:

- **One** WebSocket shared by all tabs of the origin
- **Cross-tab event delivery** — `mesh.send` from tab A surfaces in tabs B and C as `source: 'remote'`
- **A durable outbox** — events queued offline drain to the backend on reconnect
- **A logout flow** — clear the outbox, drop the transport, broadcast logout, stop, in that order

It's hub-and-spoke, not peer-to-peer. Calling it a "mesh" overstates the topology; the name is sticky.

## Quick start

```bash
pnpm install @tabmesh/core @tabmesh/transport-websocket
```

```ts
import { TabMesh } from '@tabmesh/core';
import { WebSocketTransport } from '@tabmesh/transport-websocket';

const mesh = new TabMesh({
  channelName: 'my-app',
  transport: new WebSocketTransport({ url: 'wss://api.example.com/events' }),
  // Strongly recommended in production — see "Gotchas → SharedWorker name caching"
  workerVersion: process.env.GIT_SHA,
});

await mesh.start();

// Receive
mesh.on('chat.message', (event) => {
  console.log(event.payload, 'from', event.source);
});

// Send (reaches both other tabs and the backend)
await mesh.send({ type: 'chat.message', payload: { text: 'Hello' } });
```

You also need to deploy the SharedWorker bundle at a stable URL (defaults to `/tabmesh-worker.js`). See [`packages/playground/scripts/build-worker.mjs`](packages/playground/scripts/build-worker.mjs) for the recommended esbuild config.

### React

```tsx
import { TabMeshProvider, useTabMesh, useTabMeshEvent } from '@tabmesh/react';

function App() {
  return (
    <TabMeshProvider mesh={mesh}>
      <Chat />
    </TabMeshProvider>
  );
}

function Chat() {
  const { status, send } = useTabMesh();
  useTabMeshEvent('chat.message', (event) => {
    /* handle */
  });
  return <div>Connected: {status.hubConnected ? 'yes' : 'no'}</div>;
}
```

## Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Tab A   │     │  Tab B   │     │  Tab C   │
└────┬─────┘     └────┬─────┘     └────┬─────┘
     │ MessagePort    │ MessagePort    │ MessagePort
     └────────┬───────┴────────────────┘
              ▼
       ┌─────────────┐
       │ SharedWorker│  ← single point of fan-out + outbox
       └──────┬──────┘
              │ WebSocket
              ▼
        ┌──────────┐
        │  backend │
        └──────────┘
```

- **Primary mode** uses a `SharedWorker` (Chrome, Edge, Firefox, Safari, iOS Safari 16+).
- **Fallback mode** elects a leader tab via Web Locks API → BroadcastChannel heartbeat → IndexedDB heartbeat. Used on Chrome Android, Samsung Internet, and older browsers.
- **Outbox** is an IndexedDB queue with TTL, priority ordering, and an in-memory degraded fallback.
- **Service Worker** (optional) takes over draining the outbox after the last tab closes, via Background Sync.

Detailed design notes live in [`CONTEXT.md`](CONTEXT.md) and the architecture decisions are in [`docs/adr/`](docs/adr/).

## Gotchas

A small library this protocol-heavy has sharp edges. The honest list:

### SharedWorker name caching → set `workerVersion` per deploy

Browsers cache SharedWorkers by `name`, not by script content. Without a per-deploy version suffix, an updated `tabmesh-worker.js` doesn't reach users until every client tab closes AND the browser GCs the idle worker — which can take many minutes. New tabs in the meantime keep using the old worker.

```ts
new TabMesh({
  channelName: 'my-app',
  workerVersion: process.env.GIT_SHA, // or release tag, package version
});
```

### `delivered` ≠ "the backend processed it"

Today the outbox marks an event `delivered` once `Transport.send()` returns successfully — i.e. the bytes left the browser. It does **not** wait for a backend acknowledgement. If you need that, gate on an explicit ack message in your protocol layer. A `ackMode: 'server'` config knob is on the post-1.0 roadmap.

### No replay buffer for late-joining tabs

A tab that opens after another tab broadcast an event will not receive that event. There is no historical log; new tabs start clean and should fetch state from your backend on connect. This is by design ([CONTEXT.md → Inbound Event Flow](CONTEXT.md)).

### In-browser only

Same-origin, browser-side. Not for Node, React Native, or cross-origin/cross-subdomain coordination. Web platform constraint, not a TabMesh choice.

### Mobile fallback paths get less coverage

The SharedWorker primary path is exercised by both unit tests and the [Playwright harness](e2e/multi-tab.spec.ts). The elected-leader fallback gets one Playwright test (failover) and unit tests; split-brain is unit-tested but not end-to-end. Mobile carriers and OS power management can throttle BroadcastChannel/Web Locks in ways that are hard to reproduce in CI.

### Service Worker handoff requires `deliveryUrl`

The Service Worker can drain pending events from IndexedDB after all tabs close, but it has nowhere to send them by default. Configure `serviceWorker.deliveryUrl` to an HTTP endpoint that accepts JSON event POSTs. Without it, pending events stay in the outbox for the next Hub session — they don't go anywhere.

```ts
new TabMesh({
  channelName: 'my-app',
  serviceWorker: { enabled: true, deliveryUrl: '/api/events' },
});
```

## Configuration

Type-safe; see [`packages/core/src/types.ts`](packages/core/src/types.ts) for every field.

| Field | Default | Purpose |
|---|---|---|
| `channelName` | required | Scopes the SharedWorker, IndexedDB, BroadcastChannel |
| `transport` | none | Backend connection adapter (transport-less mode is valid) |
| `workerUrl` | `/tabmesh-worker.js` | Where the SharedWorker script lives |
| `workerVersion` | none | Build identifier appended to the SharedWorker `name` |
| `pingMs` | `10000` | Tab → SharedWorker keepalive interval |
| `staleTimeoutMs` | `30000` | Worker evicts ports that miss this window |
| `persistence.defaultTTL` | 24h | Default event TTL |
| `persistence.maxQueueSize` | 1000 | Outbox cap (eviction policy: oldest delivered → oldest pending) |
| `reconnect.maxAttempts` | 10 | Transport reconnection cap |
| `reconnect.initialDelayMs` | 1000 | First reconnect backoff |
| `reconnect.backoffMultiplier` | 2 | Exponential factor |
| `reconnect.maxDelayMs` | 30000 | Backoff ceiling |
| `serviceWorker.enabled` | `false` | Background-sync handoff |
| `serviceWorker.deliveryUrl` | none | Required when `enabled: true` for actual delivery |

## System events

`mesh.on('*', handler)` sees every event including these system ones:

- `hub.connected` / `hub.disconnected`
- `transport.connected` / `transport.disconnected` / `transport.reconnecting` / `transport.error`
- `event.delivery.failed`
- `storage.degraded` (IndexedDB unavailable, in-memory fallback engaged)

## Development

```bash
pnpm install
pnpm test                # vitest, ~100 unit tests
pnpm test:e2e            # playwright (requires `pnpm exec playwright install chromium` once)
pnpm typecheck           # tsc --noEmit across all packages
pnpm biome:check         # lint + format
pnpm build               # build all packages
```

The playground demo lives in [`packages/playground`](packages/playground). `pnpm --filter @tabmesh/playground dev` starts a Vite dev server with a working multi-tab todo app + activity feed; `pnpm --filter @tabmesh/playground exec node scripts/echo-server.mjs` starts a local WebSocket echo server you can point the playground at.

## Status

Pre-1.0. The core API surface is stable enough to use, but:

- API may change before 1.0 in response to real-world feedback
- `delivered` semantics will tighten when `ackMode: 'server'` lands
- SSE and long-poll transports are roadmap, not shipped
- Vue and Svelte adapters are roadmap

If you're trying TabMesh and hit a sharp edge, open an issue. The shape of those issues is what 1.0 needs to settle.

## License

MIT © TabMesh Contributors
