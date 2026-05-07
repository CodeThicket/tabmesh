/**
 * TabMesh SharedWorker script.
 *
 * This is the Hub in primary mode. It:
 * - Maintains a registry of connected tab ports
 * - Owns the Transport connection
 * - Drains the Event Outbox
 * - Relays events between tabs
 *
 * Deploy this file at a stable URL (e.g., /tabmesh-worker.js).
 */

import type { HubMessage, OutboxEntry, TabMeshEvent, TabRegistryEntry } from '../types.js';
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
const pendingOutbox: OutboxEntry[] = [];
let drainScheduled = false;

/** Batch window for outbox drain (ms). */
const BATCH_WINDOW_MS = 50;

/** Stale tab timeout (ms). */
const STALE_TIMEOUT_MS = 30_000;

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
      handleOutboxWrite(port, msg);
      break;

    case 'outbox-flush':
      scheduleDrain();
      break;

    case 'clear-outbox':
      handleClearOutbox();
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

  // Register the port
  ports.set(msg.tabId, {
    tabId: msg.tabId,
    port,
    lastSeenAt: Date.now(),
    visibilityState: 'visible',
  });

  const response: HubMessage = { kind: 'handshake-ack', accepted: true };
  port.postMessage(response);
}

// ---------------------------------------------------------------------------
// Outbox write
// ---------------------------------------------------------------------------

function handleOutboxWrite(
  port: MessagePort,
  msg: Extract<HubMessage, { kind: 'outbox-write' }>
): void {
  const entry = msg.entry;
  pendingOutbox.push(entry);

  // Acknowledge receipt
  const ack: HubMessage = { kind: 'outbox-write-ack', eventId: entry.id };
  port.postMessage(ack);

  // Schedule a drain
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
    drain();
  }, BATCH_WINDOW_MS);
}

function drain(): void {
  if (pendingOutbox.length === 0) return;

  // Sort by priority (desc) then createdAt (asc)
  pendingOutbox.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

  const now = Date.now();
  const toDeliver: OutboxEntry[] = [];

  // Filter out expired events
  while (pendingOutbox.length > 0) {
    const entry = pendingOutbox.shift();
    if (!entry) break;
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
      continue; // Expired — discard
    }
    toDeliver.push(entry);
  }

  // Deliver each event to all connected tabs
  for (const entry of toDeliver) {
    const event: TabMeshEvent = {
      type: entry.type,
      payload: entry.payload,
      source: 'local', // Will be set correctly per-tab below
      meta: {
        internalSource: 'port',
        sourceTabId: entry.sourceTabId,
        eventId: entry.id,
        createdAt: entry.createdAt,
      },
    };

    for (const [tabId, portEntry] of ports) {
      try {
        // Set source relative to the receiving tab
        const tabEvent: TabMeshEvent = {
          ...event,
          source: tabId === entry.sourceTabId ? 'local' : 'remote',
        };
        const msg: HubMessage = { kind: 'event', event: tabEvent };
        portEntry.port.postMessage(msg);
      } catch {
        // Port likely closed — will be cleaned up by stale check
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Clear outbox
// ---------------------------------------------------------------------------

function handleClearOutbox(): void {
  pendingOutbox.length = 0;
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
