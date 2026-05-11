# Configuration

`TabMeshConfig` is the single options object passed to `new TabMesh(config)`. All fields are type-safe; the canonical source is [`packages/core/src/types.ts`](https://github.com/CodeThicket/tabmesh/blob/main/packages/core/src/types.ts).

## Required

### `channelName: string`

App-level identifier that scopes the SharedWorker name, the IndexedDB database, the BroadcastChannel, and the `sessionStorage` keys. **Required.**

```ts
new TabMesh({ channelName: 'my-app' });
```

Recommended pattern when serving multiple tenants on the same origin:

```ts
new TabMesh({ channelName: `my-app:${tenantId}:${userId}` });
```

Multiple meshes with different `channelName` on the same origin are independent — each gets its own SharedWorker instance and IndexedDB database. This costs one WebSocket per channel, so don't sub-divide more than you need to.

## Transport

### `transport?: Transport`

Backend connection adapter. Today this is `@tabmesh/transport-websocket`; SSE and long-poll adapters are on the [roadmap](/roadmap).

```ts
import { WebSocketTransport } from '@tabmesh/transport-websocket';

new TabMesh({
  channelName: 'my-app',
  transport: new WebSocketTransport({ url: 'wss://api.example.com' }),
});
```

**Transport-less mode**: omit `transport` entirely. The mesh still works for cross-tab event broadcasting; it just has no backend to forward events to. Useful for local-only coordination patterns.

### `reconnect?: Partial<ReconnectConfig>`

Configures the transport reconnection loop. Defaults shown:

```ts
new TabMesh({
  channelName: 'my-app',
  transport: ...,
  reconnect: {
    maxAttempts: 10,        // retry cap; emits transport.error after this
    initialDelayMs: 1000,   // first reconnect delay
    backoffMultiplier: 2,   // exponential factor
    maxDelayMs: 30000,      // backoff ceiling
  },
});
```

Real-world reconnect sequence with defaults: 1s, 2s, 4s, 8s, 16s, 30s, 30s, … (capped).

## SharedWorker

### `workerUrl?: string` — default `/tabmesh-worker.js`

Where the SharedWorker script is served from. The file must be served from the same origin as the page (browser security requirement).

```ts
new TabMesh({
  channelName: 'my-app',
  workerUrl: '/_static/tabmesh-worker.js', // behind a CDN/cache layer
});
```

→ Deploying the worker bundle: see [Getting Started → Deploy the SharedWorker bundle](/guide/getting-started#_2-deploy-the-sharedworker-bundle).

### `workerVersion?: string` — **strongly recommended**

Build-time version string appended to the SharedWorker `name`. Without it, deploy upgrades don't propagate to existing browser sessions.

```ts
new TabMesh({
  channelName: 'my-app',
  workerVersion: process.env.GIT_SHA,
});
```

→ Why this matters: see [Gotchas → SharedWorker name caching](/guide/gotchas#sharedworker-name-caching-set-workerversion-per-deploy).

### `pingMs?: number` — default `10000`

Interval (ms) between tab-to-worker keepalive pings. Lower values detect tab freeze faster; higher values reduce wakeups in idle apps.

### `staleTimeoutMs?: number` — default `30000`

How long (ms) the SharedWorker waits before treating a port as stale and evicting it from the registry. The **first** connecting tab's value wins for the lifetime of the worker; subsequent tabs cannot change it.

These two values are tuned together: `pingMs < staleTimeoutMs / 2` is the safe ratio. Lower values are useful for tests but not for production.

## Persistence / outbox

### `persistence?: Partial<PersistenceConfig>`

```ts
new TabMesh({
  channelName: 'my-app',
  persistence: {
    defaultTTL: 86_400_000, // 24h — events past createdAt+ttl are dropped at drain
    maxQueueSize: 1000,     // outbox cap; eviction prefers oldest delivered → oldest pending
  },
});
```

The outbox uses IndexedDB by default. When IndexedDB is unavailable (private browsing on some browsers), it falls back to an in-memory queue and emits a `storage.degraded` system event with a `console.warn`. The API surface is identical in degraded mode but events don't survive tab close.

## Service Worker handoff

### `serviceWorker?: Partial<ServiceWorkerConfig>`

Optional Background Sync integration that drains pending events after all tabs close.

```ts
new TabMesh({
  channelName: 'my-app',
  serviceWorker: {
    enabled: true,
    scriptUrl: '/tabmesh-sw.js',           // default
    deliveryUrl: '/api/events',            // required for handoff to actually deliver
  },
});
```

- `enabled` — default `false`. The SW is registered only when this is `true`.
- `scriptUrl` — where the Service Worker script is served from. Defaults to `/tabmesh-sw.js`.
- `deliveryUrl` — HTTP endpoint the SW POSTs pending events to during sync. **Without it, the SW leaves entries in the outbox for the next Hub session.**

→ Full details: [Gotchas → Service Worker handoff requires `deliveryUrl`](/guide/gotchas#service-worker-handoff-requires-deliveryurl) and [Recipes → Service Worker handoff](/recipes/service-worker-handoff).

## Leader election (fallback mode only)

### `leader?: Partial<LeaderConfig>`

```ts
new TabMesh({
  channelName: 'my-app',
  leader: {
    strategy: 'auto', // 'auto' | 'web-locks' | 'broadcast-heartbeat' | 'indexeddb-heartbeat'
  },
});
```

By default `auto` selects the best available strategy based on browser support. Override only when debugging election behaviour on specific platforms. See [Architecture → Fallback mode](/guide/architecture#fallback-mode-elected-leader) for the strategy details.

## Per-event options (passed to `mesh.send`)

These aren't part of `TabMeshConfig` but worth documenting in one place — they go on each `OutboundEvent`:

### `priority?: number` — default `0`

Higher values drain first. Useful for getting an urgent event out before a backlog of routine ones.

```ts
await mesh.send({
  type: 'auth.logout',
  payload: {},
  priority: 100,
});
```

Priority does **not** affect TTL or delivery guarantees, only drain order.

### `ttl?: number` — milliseconds

Relative to event creation time. Events past `createdAt + ttl` are discarded at the next drain — never delivered to the backend, never re-broadcast to tabs.

```ts
await mesh.send({
  type: 'presence.heartbeat',
  payload: { tabId },
  ttl: 5_000, // drop if not delivered within 5s
});
```

## Full example

```ts
import { TabMesh } from '@tabmesh/core';
import { WebSocketTransport } from '@tabmesh/transport-websocket';

const mesh = new TabMesh({
  // Required
  channelName: `chat:${tenantId}:${userId}`,
  transport: new WebSocketTransport({ url: 'wss://chat.example.com' }),

  // Strongly recommended
  workerVersion: process.env.GIT_SHA,

  // Reconnect tuning
  reconnect: {
    maxAttempts: 20,
    maxDelayMs: 60_000,
  },

  // Outbox sizing
  persistence: {
    defaultTTL: 60 * 60 * 1000,  // 1h
    maxQueueSize: 5000,
  },

  // Background sync
  serviceWorker: {
    enabled: true,
    deliveryUrl: '/api/events',
  },
});

await mesh.start();
```
