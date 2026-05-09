/**
 * TabMesh SharedWorker script.
 *
 * This is the Hub in primary mode. It:
 * - Maintains a registry of connected tab ports
 * - Owns the Transport connection
 * - Drains the IndexedDB-backed Event Outbox
 * - Relays events between tabs
 *
 * Deploy this file at a stable URL (e.g., /tabmesh-worker.js).
 */

import { EventOutbox } from '../storage/EventOutbox.js';
import type {
  HubMessage,
  TabMeshEvent,
  TabRegistryEntry,
  WorkerTransportConfig,
} from '../types.js';
import { PROTOCOL_VERSION } from '../types.js';

/** Port registry entry with the actual MessagePort. */
interface PortEntry extends TabRegistryEntry {
  port: MessagePort;
}

/** SharedWorker global scope type. */
interface SharedWorkerGlobalScope {
  onconnect: ((event: MessageEvent) => void) | null;
}

declare const self: SharedWorkerGlobalScope;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const ports = new Map<string, PortEntry>();
let drainScheduled = false;
let drainRunning = false;

/** Channel name captured from the first handshake. */
let channelName: string | null = null;

/** Lazy-initialised IndexedDB outbox. */
let outbox: EventOutbox | null = null;
let outboxReady: Promise<void> | null = null;

/** Batch window for outbox drain (ms). */
const BATCH_WINDOW_MS = 50;

/** Stale tab timeout (ms). */
const STALE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Transport state — owned by the SharedWorker.
// ---------------------------------------------------------------------------

let transportConfig: WorkerTransportConfig | null = null;
let ws: WebSocket | null = null;
let wsConnected = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MULTIPLIER = 2;

// Echo suppression: ids we forwarded to the transport. If the server bounces a
// message back with the same id, drop it so the originating tab does not see
// its own event a second time as `source: 'remote'`.
const sentIds = new Map<string, number>();
const SENT_ID_TTL_MS = 60_000;
const SENT_ID_MAX = 1000;

function rememberSent(id: string): void {
  if (!id) return;
  sentIds.set(id, Date.now() + SENT_ID_TTL_MS);
  if (sentIds.size > SENT_ID_MAX) {
    const now = Date.now();
    for (const [k, exp] of sentIds) {
      if (exp < now) sentIds.delete(k);
      if (sentIds.size <= SENT_ID_MAX) break;
    }
  }
}

function consumeIfSelf(id: string): boolean {
  if (!id) return false;
  const exp = sentIds.get(id);
  if (exp == null) return false;
  sentIds.delete(id);
  return exp >= Date.now();
}

// ---------------------------------------------------------------------------
// Connection handling
// ---------------------------------------------------------------------------

self.onconnect = (connectEvent: MessageEvent) => {
  const port = connectEvent.ports[0];
  if (!port) return;

  port.onmessage = (event: MessageEvent<HubMessage>) => {
    handleMessage(port, event.data);
  };

  port.start();
};

function handleMessage(port: MessagePort, msg: HubMessage): void {
  switch (msg.kind) {
    case 'handshake':
      handleHandshake(port, msg);
      break;

    case 'outbox-write':
      void handleOutboxWrite(port, msg);
      break;

    case 'outbox-flush':
      scheduleDrain();
      break;

    case 'clear-outbox':
      void handleClearOutbox();
      break;

    case 'broadcast-event':
      handleBroadcastEvent(port, msg);
      break;

    case 'ping':
      handlePing(port, msg);
      break;

    case 'lifecycle':
      handleLifecycle(msg);
      break;

    case 'transport-config':
      handleTransportConfig(msg.config);
      break;

    case 'transport-disconnect':
      closeTransport('explicit');
      break;
  }
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

function handleHandshake(port: MessagePort, msg: Extract<HubMessage, { kind: 'handshake' }>): void {
  if (msg.protocolVersion !== PROTOCOL_VERSION) {
    const response: HubMessage = {
      kind: 'handshake-ack',
      accepted: false,
      reason: `Protocol version mismatch. Hub: ${PROTOCOL_VERSION}, Tab: ${msg.protocolVersion}. Please reload the page.`,
    };
    port.postMessage(response);
    return;
  }

  // First handshake decides the channel — every tab in this worker shares it
  // (the worker is namespaced by `tabmesh:{channelName}` in SharedWorker.name).
  if (!channelName) {
    channelName = msg.channelName;
    ensureOutbox();
  }

  // Register the port
  ports.set(msg.tabId, {
    tabId: msg.tabId,
    port,
    lastSeenAt: Date.now(),
    visibilityState: 'visible',
  });

  const response: HubMessage = { kind: 'handshake-ack', accepted: true };
  port.postMessage(response);

  // Replay current transport state to the late joiner. The worker emits
  // transport.connected/disconnected once on each transition; tabs that arrive
  // after the transition would otherwise default to "disconnected" forever.
  if (transportConfig) {
    postSystemEventToPort(port, wsConnected ? 'transport.connected' : 'transport.disconnected', {});
  }

  // Pick up any pending events left behind by a previous worker session.
  scheduleDrain();
}

// ---------------------------------------------------------------------------
// Outbox lifecycle
// ---------------------------------------------------------------------------

function ensureOutbox(): Promise<void> {
  if (outboxReady) return outboxReady;
  if (!channelName) return Promise.resolve();
  outbox = new EventOutbox(channelName);
  outboxReady = outbox.open().then(({ degraded }) => {
    if (degraded) {
      emitSystemEvent('storage.degraded', { reason: 'indexeddb_unavailable' });
    }
  });
  return outboxReady;
}

// ---------------------------------------------------------------------------
// Outbox write
// ---------------------------------------------------------------------------

async function handleOutboxWrite(
  port: MessagePort,
  msg: Extract<HubMessage, { kind: 'outbox-write' }>
): Promise<void> {
  await ensureOutbox();
  if (!outbox) return;

  await outbox.put(msg.entry);

  const ack: HubMessage = { kind: 'outbox-write-ack', eventId: msg.entry.id };
  port.postMessage(ack);

  scheduleDrain();
}

// ---------------------------------------------------------------------------
// Outbox drain
// ---------------------------------------------------------------------------

function scheduleDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;

  setTimeout(() => {
    drainScheduled = false;
    void drain();
  }, BATCH_WINDOW_MS);
}

async function drain(): Promise<void> {
  if (drainRunning) {
    // Coalesce — another drain is already in flight; reschedule.
    scheduleDrain();
    return;
  }
  await ensureOutbox();
  if (!outbox) return;

  // If transport is configured but not yet open, hold events until WS comes up.
  if (transportConfig && !wsConnected) return;

  drainRunning = true;
  try {
    const pending = await outbox.readPending();
    // Even when there is nothing to send, fall through to
    // `markDeliveredAndCleanup` so previously-delivered and TTL-expired
    // entries are reclaimed. This is the "cleanup pass" CONTEXT.md asks
    // stop() to trigger when the queue is idle.
    const deliveredIds: string[] = [];

    for (const entry of pending) {
      // Distribute to all connected tabs first — local fan-out is the cheapest
      // step and lets the UI react before the WS round-trip.
      const baseEvent: TabMeshEvent = {
        type: entry.type,
        payload: entry.payload,
        source: 'local',
        meta: {
          internalSource: 'port',
          sourceTabId: entry.sourceTabId,
          eventId: entry.id,
          createdAt: entry.createdAt,
        },
      };

      for (const [tabId, portEntry] of ports) {
        try {
          const tabEvent: TabMeshEvent = {
            ...baseEvent,
            source: tabId === entry.sourceTabId ? 'local' : 'remote',
          };
          const out: HubMessage = { kind: 'event', event: tabEvent };
          portEntry.port.postMessage(out);
        } catch {
          // Port likely closed — stale-port sweeper will tidy up.
        }
      }

      // Forward to backend over WebSocket if configured.
      let transportOk = true;
      if (transportConfig) {
        if (ws && wsConnected) {
          try {
            ws.send(JSON.stringify({ type: entry.type, payload: entry.payload, id: entry.id }));
            rememberSent(entry.id);
          } catch {
            transportOk = false;
            emitSystemEvent('event.delivery.failed', {
              eventId: entry.id,
              reason: 'transport_send_failed',
            });
          }
        } else {
          transportOk = false;
        }
      }

      // Mark delivered when transport accepted the event (or no transport configured).
      if (transportOk) {
        deliveredIds.push(entry.id);
      }
    }

    // Always run the cleanup transaction — it reclaims previously-delivered
    // and TTL-expired entries, even when nothing new was just sent.
    await outbox.markDeliveredAndCleanup(deliveredIds);
  } finally {
    drainRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Clear outbox
// ---------------------------------------------------------------------------

async function handleClearOutbox(): Promise<void> {
  await ensureOutbox();
  if (outbox) {
    await outbox.clear();
  }
}

// ---------------------------------------------------------------------------
// Broadcast event (no outbox)
// ---------------------------------------------------------------------------

function handleBroadcastEvent(
  _senderPort: MessagePort,
  msg: Extract<HubMessage, { kind: 'broadcast-event' }>
): void {
  const eventMsg: HubMessage = { kind: 'event', event: msg.event };

  // Send to all connected tabs (including the sender, since it's a broadcast)
  for (const [, entry] of ports) {
    try {
      entry.port.postMessage(eventMsg);
    } catch {
      // Port likely closed
    }
  }
}

// ---------------------------------------------------------------------------
// Keepalive
// ---------------------------------------------------------------------------

function handlePing(port: MessagePort, msg: Extract<HubMessage, { kind: 'ping' }>): void {
  const entry = ports.get(msg.tabId);
  if (entry) {
    entry.lastSeenAt = Date.now();
  }
  const pong: HubMessage = { kind: 'pong', tabId: msg.tabId };
  port.postMessage(pong);
}

function handleLifecycle(msg: Extract<HubMessage, { kind: 'lifecycle' }>): void {
  const entry = ports.get(msg.tabId);
  if (entry) {
    entry.lastSeenAt = Date.now();
    entry.visibilityState = msg.state;
  }
}

// ---------------------------------------------------------------------------
// Transport (WebSocket only for v1)
// ---------------------------------------------------------------------------

function handleTransportConfig(config: WorkerTransportConfig): void {
  // Only the first transport-config wins. Late configs are ignored — the
  // worker is process-singleton and reconfiguring mid-flight risks dropping
  // pending events.
  if (transportConfig) return;
  transportConfig = config;
  openTransport();
}

function openTransport(): void {
  if (!transportConfig) return;
  if (transportConfig.kind !== 'websocket') return;

  try {
    ws = new WebSocket(transportConfig.url, transportConfig.protocols);
  } catch (err) {
    emitSystemEvent('transport.error', {
      message: err instanceof Error ? err.message : String(err),
    });
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    wsConnected = true;
    reconnectAttempt = 0;
    emitSystemEvent('transport.connected', {});
    // Drain any events buffered while the transport was down.
    scheduleDrain();
  };

  ws.onmessage = (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    onTransportMessage(event.data);
  };

  ws.onerror = () => {
    emitSystemEvent('transport.error', { message: 'websocket_error' });
  };

  ws.onclose = () => {
    wsConnected = false;
    ws = null;
    emitSystemEvent('transport.disconnected', {});
    scheduleReconnect();
  };
}

function closeTransport(reason: string): void {
  // Stop reconnect attempts and tear down the WS — used by the explicit
  // logout flow so we don't replay events under a stale auth token.
  transportConfig = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  if (ws) {
    try {
      ws.onclose = null;
      ws.close();
    } catch {
      // already closed
    }
    ws = null;
  }
  wsConnected = false;
  emitSystemEvent('transport.disconnected', { reason });
}

function scheduleReconnect(): void {
  if (!transportConfig) return;
  if (reconnectTimer) return;
  const delay = Math.min(
    RECONNECT_INITIAL_MS * RECONNECT_MULTIPLIER ** reconnectAttempt,
    RECONNECT_MAX_MS
  );
  reconnectAttempt += 1;
  emitSystemEvent('transport.reconnecting', { attempt: reconnectAttempt, delayMs: delay });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openTransport();
  }, delay);
}

function onTransportMessage(data: string): void {
  let parsed: { type: string; payload: unknown; id?: string };
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }
  if (typeof parsed?.type !== 'string') return;

  // Drop server echoes of our own outbound events.
  if (typeof parsed.id === 'string' && consumeIfSelf(parsed.id)) return;

  const event: TabMeshEvent = {
    type: parsed.type,
    payload: parsed.payload,
    source: 'remote',
    meta: {
      internalSource: 'transport',
      sourceTabId: '',
      eventId: parsed.id ?? '',
      createdAt: Date.now(),
    },
  };

  const msg: HubMessage = { kind: 'event', event };
  for (const [, portEntry] of ports) {
    try {
      portEntry.port.postMessage(msg);
    } catch {
      // Port likely closed
    }
  }
}

function emitSystemEvent(type: string, payload: unknown): void {
  const msg: HubMessage = { kind: 'system-event', event: buildSystemEvent(type, payload) };
  for (const [, portEntry] of ports) {
    try {
      portEntry.port.postMessage(msg);
    } catch {
      // Port likely closed
    }
  }
}

function postSystemEventToPort(port: MessagePort, type: string, payload: unknown): void {
  const msg: HubMessage = { kind: 'system-event', event: buildSystemEvent(type, payload) };
  try {
    port.postMessage(msg);
  } catch {
    // Port likely closed
  }
}

function buildSystemEvent(type: string, payload: unknown): TabMeshEvent {
  return {
    type,
    payload,
    source: 'local',
    meta: {
      internalSource: 'port',
      sourceTabId: '',
      eventId: '',
      createdAt: Date.now(),
    },
  };
}

// Periodically clean up stale ports
setInterval(() => {
  const now = Date.now();
  for (const [tabId, entry] of ports) {
    if (now - entry.lastSeenAt > STALE_TIMEOUT_MS) {
      ports.delete(tabId);
      try {
        entry.port.close();
      } catch {
        // Already closed
      }
    }
  }
}, 15_000);
