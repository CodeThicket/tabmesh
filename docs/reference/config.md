# Configuration

::: warning Migrating
Field-by-field configuration table lands in the next docs PR.
:::

The full type is exported from [`@tabmesh/core` types.ts](https://github.com/CodeThicket/tabmesh/blob/main/packages/core/src/types.ts). Until this page is filled out, the [README configuration table](https://github.com/CodeThicket/tabmesh#configuration) covers the same ground.

Quick reference (defaults in parens):

- `channelName` (required)
- `transport` (none — transport-less mode is valid)
- `workerUrl` (`/tabmesh-worker.js`)
- `workerVersion` (none — strongly recommended in production)
- `pingMs` (`10000`)
- `staleTimeoutMs` (`30000`)
- `persistence.defaultTTL` (24h), `persistence.maxQueueSize` (1000)
- `reconnect.maxAttempts` (10), `initialDelayMs` (1000), `backoffMultiplier` (2), `maxDelayMs` (30000)
- `serviceWorker.enabled` (`false`), `serviceWorker.scriptUrl` (`/tabmesh-sw.js`), `serviceWorker.deliveryUrl` (none — required if you want SW handoff to actually deliver)
