# Gotchas

::: warning Migrating
The full gotchas list — the most important page for adopters — is being moved here from the [README gotchas section](https://github.com/CodeThicket/tabmesh#gotchas). Read the README until this page is filled in.
:::

The shortlist, until this page expands:

- **SharedWorker name caching** → set `workerVersion` per deploy.
- **`delivered` ≠ "the backend processed it"** → wait for explicit ACK if you need it; `ackMode: 'server'` is on the [roadmap](/roadmap).
- **No replay buffer for late-joining tabs** — by design.
- **In-browser only**, same-origin only.
- **Service Worker handoff requires `deliveryUrl`** — without it, the SW leaves pending events in the outbox for the next Hub session.

→ Read the [README gotchas](https://github.com/CodeThicket/tabmesh#gotchas) for the explanations until this page fills out.
