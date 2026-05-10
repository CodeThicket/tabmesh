# System events

::: warning Migrating
Per-event payload shapes and emission rules land in the next docs PR.
:::

`mesh.on('*', handler)` sees every event including these system ones:

- `hub.connected`
- `hub.disconnected`
- `transport.connected`
- `transport.disconnected`
- `transport.reconnecting`
- `transport.error`
- `event.delivery.failed`
- `storage.degraded`

Until this page expands, the canonical source is [`packages/core/src/types.ts`](https://github.com/CodeThicket/tabmesh/blob/main/packages/core/src/types.ts) (search for `SystemEventType`).
