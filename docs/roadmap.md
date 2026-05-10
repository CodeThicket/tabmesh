# Roadmap

::: warning Migrating
The full tier-list roadmap with linked GitHub issues is in flight. Until then, [`CONTEXT.md → Post-v1`](https://github.com/CodeThicket/tabmesh/blob/main/CONTEXT.md#post-v1) has the underlying inventory.
:::

The shape of this page (per [ADR-0004](/adr/0004-vitepress-single-site-at-tabmesh-dev) and the grilling pass that produced this site):

## Next — committed

- Server ACK mode (`ackMode: 'server'`) — closes the largest correctness gap before 1.0
- Vue composables, Svelte stores
- Hand-curated API reference filled out across [`/reference`](/reference/tabmesh-class)

## Considering — happy to take contributions

- SSE adapter (`@tabmesh/transport-sse`)
- Long-poll adapter (`@tabmesh/transport-longpoll`)
- DevTools extension (inspect outbox, port registry, WS frames in real time)
- MessagePack serializer
- Web Worker for batching and compression
- `sendLifecycle` promoted to the `Hub` interface (helps elected-leader mode pick up visibility events)
- Opt-in late-joiner replay buffer (`replayLastN`)

## Out of scope

- Cross-origin or cross-subdomain coordination (browser platform constraint, not solvable without a backend)
- Node / React Native runtime support
- Peer-to-peer mesh without a hub
- Hosting our own backend transport service

## Recent releases

The history of what's actually shipped lives in [GitHub Releases](https://github.com/CodeThicket/tabmesh/releases) — each release links to the merged PRs and the changelog.
