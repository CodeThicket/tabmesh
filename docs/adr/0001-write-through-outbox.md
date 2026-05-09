# Write-through Outbox for all outbound events

All outbound events pass through an IndexedDB-backed Event Outbox before being sent via Transport. The Outbox owner differs by mode: in primary mode (SharedWorker), the Hub receives events via MessagePort and writes to IndexedDB before sending. In fallback mode (elected Leader), tabs write to IndexedDB directly and notify the Leader to drain.

We chose persistence-before-send over optimistic send (deliver first, persist on failure) because it guarantees zero event loss during offline periods, Hub restarts, and rolling deployments — using a single mechanism for all cases.

## Considered Options

- **Persistence-before-send (chosen)**: Events are written to IndexedDB before Transport send. Durable by default. In primary mode the Hub is the sole writer (clean single-writer model). In fallback mode tabs write directly (necessary because the elected Leader may not exist yet).
- **Optimistic send with fallback**: Deliver events directly, fall back to IndexedDB on failure. Faster happy path, but introduces ACK/timeout complexity and a loss window if the Hub dies between receiving and persisting.
- **Hub-only persistence, no pre-write**: Tabs send to Hub, Hub persists and delivers. Simplest, but events in-flight (MessagePort buffer, BroadcastChannel) are lost if the Hub dies before persisting.

## Consequences

- Every send pays an IndexedDB write. Mitigated by batching (~50ms window) and flushing in a single transaction.
- The 1000 events/sec benchmark target needs validation against IndexedDB write throughput with batching.
- The Outbox is load-bearing infrastructure — drain logic, cleanup, delivery status, Service Worker handoff, and session scoping all depend on it.
- The two modes (Hub-writes vs tab-writes) mean the Outbox write path has two implementations behind the Hub interface.
