# Architecture Decisions

Records of architectural decisions taken during TabMesh's development. Each ADR is short — usually 1–3 paragraphs explaining what was decided and why, plus the rejected alternatives when those are worth remembering.

## Index

- [0001 — Write-through Outbox for all outbound events](./0001-write-through-outbox)
- [0002 — SharedWorker as the primary Hub implementation](./0002-sharedworker-primary-hub)
- [0003 — Distribute pre-built worker bundles inside `@tabmesh/core`](./0003-distribute-prebuilt-worker-bundles)
- [0004 — Single VitePress site at `tabmesh.dev` for docs, roadmap, and playground](./0004-vitepress-single-site-at-tabmesh-dev)

## When we add an ADR

A decision warrants an ADR when **all three** are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful.
2. **Surprising without context** — a future reader will look at the code and wonder why.
3. **The result of a real trade-off** — there were genuine alternatives.

Routine choices ("we use TypeScript", "we use pnpm workspaces") don't get an ADR. Only the surprising or load-bearing ones.
