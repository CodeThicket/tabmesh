# Auth & logout

::: warning Coming soon
This recipe is planned but not written yet. The pattern is documented in [CONTEXT.md → Session & Auth](https://github.com/CodeThicket/tabmesh/blob/main/CONTEXT.md#session--auth) and the canonical sequence is exercised in the [playground's `MeshStatus.tsx`](https://github.com/CodeThicket/tabmesh/blob/main/packages/playground/src/components/MeshStatus.tsx). The order matters:

```ts
await mesh.clearOutbox();
await mesh.disconnectTransport();
mesh.broadcast({ type: 'auth.logout', payload: {} });
await mesh.stop();
```

The full recipe with race-condition reasoning, error handling, and multi-tab UI patterns lands in a follow-up. If you need it sooner, [open an issue](https://github.com/CodeThicket/tabmesh/issues/new) and it'll get prioritised.
:::
