# Architecture

::: warning Migrating
This page is being migrated from the [README architecture section](https://github.com/CodeThicket/tabmesh#architecture). The diagrams and full explainer arrive in the next docs PR.
:::

For now, the short version:

- **Primary mode** uses a `SharedWorker` shared across all tabs of the same origin. The worker holds the transport and the IndexedDB outbox. Tabs talk to it over `MessagePort`.
- **Fallback mode** elects a leader tab via Web Locks API → BroadcastChannel heartbeat → IndexedDB heartbeat. Used when SharedWorker isn't available (some mobile browsers).
- **Outbox** is IndexedDB-backed with TTL, priority ordering, and an in-memory degraded fallback.
- **Service Worker** (optional) takes over outbox draining after the last tab closes, via Background Sync.

→ See [ADR-0001](/adr/0001-write-through-outbox) and [ADR-0002](/adr/0002-sharedworker-primary-hub) for the design rationale.
