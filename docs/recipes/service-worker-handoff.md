# Service Worker handoff

::: warning Coming soon
The handoff path is implemented (see [PR #16](https://github.com/CodeThicket/tabmesh/pull/16)) and tested end-to-end via Playwright + CDP, but the recipe walking through `serviceWorker.deliveryUrl` setup, the `tabmesh-sw.js` deployment, and "what to do on the backend when sync fires" hasn't been written yet.

The minimum viable version:

1. Copy `node_modules/@tabmesh/core/dist/tabmesh-sw.js` to your app's `public/` directory.
2. Configure: `serviceWorker: { enabled: true, deliveryUrl: '/api/events' }`.
3. Your `/api/events` endpoint accepts JSON `POST` with `{ type, payload, id, sourceTabId }`. Return `200` to mark the event as delivered. Non-`200` responses leave it pending for the next sync.

A full walkthrough — including testing locally without waiting for the browser to schedule sync — lands in a follow-up.
:::
