# Gotchas

A small library this protocol-heavy has sharp edges. Read this page before adopting in production — most adoption pain comes from one of these six items.

## SharedWorker name caching → set `workerVersion` per deploy

Browsers cache `SharedWorker` instances by **name**, not by script content. Without a per-deploy version suffix, an updated `tabmesh-worker.js` doesn't reach users until every client tab closes **AND** the browser garbage-collects the idle worker — which can take many minutes. New tabs in the same browser session in the meantime keep using the **old** worker.

This bit hard during development when shipping bug fixes (see [PR #11](https://github.com/CodeThicket/tabmesh/pull/11) for the full discovery).

**Fix**: include your build identifier in `workerVersion`:

```ts
new TabMesh({
  channelName: 'my-app',
  workerVersion: process.env.GIT_SHA,
  // also accepts: package.json version, release tag, build timestamp, ...
});
```

What happens with `workerVersion` set:

- Each deploy spawns a fresh `SharedWorker` instance for new tabs.
- Old tabs keep talking to the old worker until they reload — natural migration, no surprise behaviour.
- The same `channelName` can coexist across versions during the rollout window.

What happens without it: the bug fix you shipped is invisible for an unbounded amount of time.

→ Implementation detail: the worker name becomes `tabmesh:{channelName}:{workerVersion}`. Without the version, it's just `tabmesh:{channelName}`.

## `delivered` ≠ "the backend processed it"

Today the outbox marks an event `delivered` once `Transport.send()` returns successfully — i.e. the bytes left the browser. It does **not** wait for a backend acknowledgement.

If you need at-least-once delivery semantics, gate on an explicit ack message in your protocol layer:

```ts
mesh.send({ type: 'order.create', payload: order });

// Wait for the backend to confirm. Your backend should echo an event
// with the same id once the work is durable.
await new Promise((resolve, reject) => {
  const off = mesh.on('order.created', (event) => {
    if (event.source === 'remote' && event.meta.eventId === order.id) {
      off();
      resolve(event);
    }
  });
  setTimeout(() => { off(); reject(new Error('timeout')); }, 10_000);
});
```

A built-in `ackMode: 'server'` option is on the [roadmap](/roadmap) — when it lands, events stay `pending` in the outbox until the backend sends an explicit ack message. Until then, the protocol-level pattern above is the documented approach.

## No replay buffer for late-joining tabs

A tab that opens after another tab broadcast an event will **not** receive that event. There is no historical log. New tabs start with a clean slate.

This is by design ([`CONTEXT.md → Inbound Event Flow`](https://github.com/CodeThicket/tabmesh/blob/main/CONTEXT.md#events)). The rationale is that maintaining a replay buffer cross-tab is a tarpit — TTLs, ordering, deduplication, memory bounds — and your backend already has authoritative state for anything important.

**Pattern**: when a new tab connects, fetch the current state from your backend. Subscribe to ongoing events for incremental updates.

```ts
async function bootstrap() {
  const initialState = await fetch('/api/state').then(r => r.json());
  applyState(initialState);

  mesh.on('order.updated', (event) => applyDelta(event.payload));
}
```

If you genuinely need an opt-in replay buffer (e.g. for chat history within an active session), it's on the [Considering tier of the roadmap](/roadmap) — open an issue with your use case.

## In-browser only

TabMesh is browser-side, same-origin only. **Not** for:

- **Node.js** or **Bun** runtimes — no `SharedWorker`, no `BroadcastChannel` semantics that match.
- **React Native** — same reason.
- **Cross-origin** coordination — `https://app.example.com` and `https://admin.example.com` cannot share a `SharedWorker`. This is a browser platform constraint, not a TabMesh limitation.
- **Cross-browser-profile** or **cross-incognito-window** coordination — same constraint.

If your tabs span subdomains, the standard workaround is to host your app on a single subdomain (e.g. `app.example.com`) and route within it. If you really need cross-origin event coordination, you need a backend pubsub channel — TabMesh isn't the right tool.

## Mobile fallback paths get less coverage

The SharedWorker primary path is exercised by both unit tests and the [Playwright harness](https://github.com/CodeThicket/tabmesh/blob/main/e2e/multi-tab.spec.ts). The elected-leader fallback path gets:

- Unit tests for leader election (Web Locks, BroadcastChannel heartbeat, IndexedDB heartbeat strategies)
- One Playwright e2e test for failover ([PR #15](https://github.com/CodeThicket/tabmesh/pull/15))
- Split-brain resolution is unit-tested but not end-to-end

Mobile carriers and OS power management can throttle `BroadcastChannel` and Web Locks in ways that are hard to reproduce in CI:

- Background tabs may have their timers coalesced or paused.
- iOS Safari may suspend `BroadcastChannel` in low-power mode.
- Chrome on Android can put inactive workers to sleep aggressively.

**If you're shipping a mobile-heavy product**, exercise the fallback path on real devices before depending on TabMesh for anything critical. Specifically: test what happens when the leader tab is backgrounded for >30 seconds, and verify failover to a foreground tab.

## Service Worker handoff requires `deliveryUrl`

The Service Worker can drain pending events from IndexedDB **after all tabs close**, but it has nowhere to send them by default. You must configure `serviceWorker.deliveryUrl` to an HTTP endpoint that accepts JSON event POSTs:

```ts
new TabMesh({
  channelName: 'my-app',
  serviceWorker: {
    enabled: true,
    deliveryUrl: '/api/events',
  },
});
```

Without `deliveryUrl`, the SW leaves pending entries in the outbox for the next Hub session to drain. This was previously a silent data-loss bug — the SW would mark events as delivered without sending them anywhere (fixed in [PR #10](https://github.com/CodeThicket/tabmesh/pull/10)).

The backend endpoint receives events as JSON `POST` with the shape:

```json
{
  "type": "order.create",
  "payload": { "...": "..." },
  "id": "abc123-1",
  "sourceTabId": "abc123"
}
```

Return `200` to mark the event delivered. Non-200 (or network failure) leaves it pending for the next sync. The browser schedules Background Sync at its own discretion — there's no API to force it from the page side.

## Bonus: drain happens once per tab, even on reconnect

This isn't a gotcha you'll likely hit, but worth knowing for debugging: when the WebSocket drops and reconnects, the worker doesn't re-fan-out previously-distributed events to your tab. It only retries the WS forward. So if your tab's UI dropped an event during a transient disconnect (e.g. the user navigated away from the page), reloading is the recovery path — TabMesh won't replay it.

Same reasoning as "no replay buffer for late-joining tabs": cross-session reliable delivery is your backend's job.

## What's next

→ [Architecture](./architecture)
→ [Roadmap](/roadmap)
→ [Open an issue](https://github.com/CodeThicket/tabmesh/issues/new) if you hit a gotcha not listed here
