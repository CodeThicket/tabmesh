# Types

::: warning Migrating
Curated type reference lands in the next docs PR.
:::

The full type surface lives in [`packages/core/src/types.ts`](https://github.com/CodeThicket/tabmesh/blob/main/packages/core/src/types.ts). It's hand-written and short — readable end-to-end in ~5 minutes.

Likely-to-be-curated entries on this page:

- `OutboundEvent<T>` — what you pass to `mesh.send`
- `TabMeshEvent<T>` — what handlers receive
- `EventSource` — `'local' | 'remote'`
- `TabMeshConfig` — full config shape
- `TabMeshStatus` — what `getStatus()` returns
- `Transport` — interface to implement for custom transport adapters
