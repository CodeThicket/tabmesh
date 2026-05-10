# `TabMesh` class

::: warning Migrating
Full method-by-method API reference lands in the next docs PR.
:::

Public methods (full signatures land here next):

- `new TabMesh(config)` — construct
- `start()` — connect the hub, flush pre-start buffer
- `stop()` — disconnect and flush
- `send(event)` — submit an outbound event
- `on(type, handler)` — subscribe to an event type, or `'*'` for all
- `broadcast(event)` — ephemeral cross-tab broadcast (no outbox, no transport)
- `clearOutbox()` — drop all pending events
- `disconnectTransport()` — close the transport without stopping the mesh
- `setSession({ userId?, tenantId?, sessionId? })` / `getSession()`
- `getStatus()` — current `{ started, hubMode, hubConnected, role, transportState, tabId, degraded, leaderTabId, term }`

Until this page is filled in, the canonical source is [`packages/core/src/TabMesh.ts`](https://github.com/CodeThicket/tabmesh/blob/main/packages/core/src/TabMesh.ts) — the file is short and JSDoc-commented.
