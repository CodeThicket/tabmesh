# System events

TabMesh emits internal lifecycle and runtime events alongside your application events. Subscribe with `mesh.on(type, handler)` for a specific event, or `mesh.on('*', handler)` to receive everything.

System events are differentiated from app events only by their `type` strings — same `TabMeshEvent` shape, same handler API.

## Hub lifecycle

### `hub.connected`

This tab has connected to the Hub (SharedWorker or elected Leader). Emitted once during `mesh.start()`.

```ts
{
  type: 'hub.connected',
  payload: { tabId: string; hubMode: 'shared-worker' | 'elected-leader' | 'degraded' },
  source: 'local',
  meta: { ... },
}
```

### `hub.disconnected`

This tab has lost contact with the Hub. Emitted when `mesh.stop()` runs, or when the Hub goes away unexpectedly (e.g. SharedWorker terminated by the browser).

```ts
{
  type: 'hub.disconnected',
  payload: { tabId: string },
  source: 'local',
  meta: { ... },
}
```

## Transport lifecycle

### `transport.connected`

The backend transport (WebSocket today) has opened. For late-joining tabs that arrive after the connection was already open, this event is synthesised on handshake so the status panel reflects reality (see [PR #7](https://github.com/CodeThicket/tabmesh/pull/7)).

```ts
{
  type: 'transport.connected',
  payload: {},
  source: 'local',
  meta: { ... },
}
```

### `transport.disconnected`

The transport closed. Could be a network drop (retries will kick in) or an explicit `mesh.disconnectTransport()` call (no retries).

```ts
{
  type: 'transport.disconnected',
  payload: { reason?: string },
  source: 'local',
  meta: { ... },
}
```

When `reason: 'explicit'`, the disconnect was intentional (e.g. logout flow). Reconnects are suppressed.

### `transport.reconnecting`

The transport is retrying. Includes the attempt number and the delay until the next try.

```ts
{
  type: 'transport.reconnecting',
  payload: { attempt: number; delayMs: number },
  source: 'local',
  meta: { ... },
}
```

### `transport.error`

A transport-level error occurred. Includes a message; payload shape varies by transport adapter.

```ts
{
  type: 'transport.error',
  payload: { message: string; reason?: string; attempts?: number },
  source: 'local',
  meta: { ... },
}
```

`reason: 'max_retries_exhausted'` is emitted by the elected-leader hub when the reconnect cap is hit (the SharedWorker hub retries forever).

## Delivery failures

### `event.delivery.failed`

The Hub exhausted retries (or failed for a non-retriable reason) for a specific event. Includes the `eventId` so you can correlate with the original send.

```ts
{
  type: 'event.delivery.failed',
  payload: { eventId: string; reason: string },
  source: 'local',
  meta: { ... },
}
```

Common `reason` values:

- `transport_send_failed` — the transport threw when forwarding the event. The event stays in the outbox for the next drain.

## Storage degraded

### `storage.degraded`

IndexedDB is unavailable; the mesh has fallen back to an in-memory outbox. Events sent during this session won't survive a tab close.

```ts
{
  type: 'storage.degraded',
  payload: { reason: string },
  source: 'local',
  meta: { ... },
}
```

The mesh also logs a `console.warn` when this fires, and disables Service Worker handoff (no IndexedDB → nothing for the SW to drain).

Common causes: private browsing on Safari, sandboxed iframes, browser storage quota exceeded.

## Wildcard subscription

`mesh.on('*', handler)` receives every event — system and application — in delivery order. Useful for:

- Debug surfaces (the playground's Activity Feed uses this)
- Logging / telemetry
- Building DevTools-style introspection

```ts
mesh.on('*', (event) => {
  if (event.type.startsWith('transport.')) {
    metrics.recordTransportEvent(event.type, event.payload);
  }
});
```

## `event.meta`

Every event includes a `meta` object with debug-only fields. Public:

- `meta.eventId: string` — the unique id of the event (matches what `send` returned).
- `meta.sourceTabId: string` — the tab id that originated the event.
- `meta.createdAt: number` — timestamp at send time.

Internal (for debugging only, not part of the public API):

- `meta.internalSource: 'port' | 'broadcast' | 'transport'` — which mechanism delivered the event to this tab.

## What's next

→ [TabMesh class reference](./tabmesh-class)
→ [Types](./types)
