# Custom transport

::: warning Coming soon
The `Transport` interface is small (5 methods + 3 callback slots, all in [`types.ts`](https://github.com/CodeThicket/tabmesh/blob/main/packages/core/src/types.ts)). The reference implementation is [`@tabmesh/transport-websocket`](https://github.com/CodeThicket/tabmesh/blob/main/packages/transport-websocket/src/WebSocketTransport.ts) — short enough to copy and adapt for SSE or long-poll.

Full recipe with reconnection wiring, `getWorkerConfig` (so the SharedWorker can rebuild the connection), and error-handling patterns lands in a follow-up. SSE and long-poll adapters are on the [roadmap](/roadmap) — if you build one in the meantime, a PR is very welcome.
:::
