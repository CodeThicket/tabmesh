/**
 * Core type definitions for TabMesh.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * An outbound event created by the application via `mesh.send()`.
 *
 * @template T - The payload type
 */
export interface OutboundEvent<T = unknown> {
  /** Free-form event type string. Dot-notation is a convention, not enforced. */
  type: string;
  /** Arbitrary event data. */
  payload: T;
  /**
   * Controls send order. Higher-priority events are drained from the Outbox
   * before lower-priority ones. Does not affect TTL or delivery guarantees.
   * @default 0
   */
  priority?: number;
  /**
   * Time-to-live in milliseconds, relative to the event's creation time.
   * Expired events are discarded during Outbox drain.
   */
  ttl?: number;
}

/** The source of a delivered event. */
export type EventSource = 'local' | 'remote';

/** Internal transport mechanism that delivered the event (debugging only). */
export type InternalSource = 'port' | 'broadcast' | 'transport';

/**
 * A fully-resolved event as delivered to `mesh.on()` handlers.
 *
 * @template T - The payload type
 */
export interface TabMeshEvent<T = unknown> {
  /** Free-form event type string. */
  type: string;
  /** Arbitrary event data. */
  payload: T;
  /**
   * `'local'` if originated from this TabMesh client,
   * `'remote'` if originated outside (another tab or the backend).
   */
  source: EventSource;
  /** Internal metadata (not part of the public API). */
  meta: {
    /** The internal delivery mechanism. For debugging only. */
    internalSource: InternalSource;
    /** The tab that originated this event. */
    sourceTabId: string;
    /** Monotonic event ID: `{tabId}-{counter}`. */
    eventId: string;
    /** Timestamp when the event was created. */
    createdAt: number;
  };
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

/** Delivery status of an outbox entry. */
export type DeliveryStatus = 'pending' | 'delivered';

/**
 * A serialized event stored in the IndexedDB Outbox.
 */
export interface OutboxEntry {
  /** Monotonic event ID: `{tabId}-{counter}`. */
  id: string;
  /** The event type. */
  type: string;
  /** Serialized event payload. */
  payload: unknown;
  /** Priority for drain ordering. */
  priority: number;
  /** Absolute expiry timestamp (createdAt + ttl), or `undefined` if no TTL. */
  expiresAt?: number;
  /** When the event was created. */
  createdAt: number;
  /** Current delivery status. */
  status: DeliveryStatus;
  /** The tab that created this event. */
  sourceTabId: string;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * A pluggable backend connection adapter.
 *
 * Transports are dumb pipes - they never see structured Event objects,
 * only serialized strings. Reconnection is owned by the Hub, not the Transport.
 */
export interface Transport {
  /** Open the connection. */
  connect(): Promise<void>;
  /** Close the connection. */
  disconnect(): Promise<void>;
  /** Send a serialized message. */
  send(data: string): Promise<void>;

  /** Called when a message is received from the backend. */
  onMessage: ((data: string) => void) | null;
  /** Called when the transport disconnects. */
  onDisconnect: (() => void) | null;
  /** Called on transport-level errors. */
  onError: ((error: Error) => void) | null;

  /**
   * Optional. When the SharedWorker hub is selected, the worker — not the
   * tab — owns the connection. Adapters that can be opened inside a Worker
   * return a serialisable description here so the SharedWorker can rebuild
   * an equivalent connection. Returning `null` (or omitting the method)
   * means this adapter only works in elected-leader mode.
   */
  getWorkerConfig?(): WorkerTransportConfig | null;
}

/**
 * Serialisable transport descriptor handed to the SharedWorker.
 * Only WebSocket is built into the worker for v1.
 */
export type WorkerTransportConfig = {
  kind: 'websocket';
  url: string;
  protocols?: string | string[];
};

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

/** Visibility state of a connected tab. */
export type TabVisibilityState = 'visible' | 'hidden' | 'frozen';

/** Registry entry for a connected tab (tracked by the Hub). */
export interface TabRegistryEntry {
  tabId: string;
  lastSeenAt: number;
  visibilityState: TabVisibilityState;
}

/**
 * Messages sent between tabs and the Hub over MessagePort or BroadcastChannel.
 */
export type HubMessage =
  | { kind: 'handshake'; tabId: string; protocolVersion: number; channelName: string }
  | { kind: 'handshake-ack'; accepted: boolean; reason?: string }
  | { kind: 'event'; event: TabMeshEvent }
  | { kind: 'outbox-write'; entry: OutboxEntry }
  | { kind: 'outbox-write-ack'; eventId: string }
  | { kind: 'outbox-flush' }
  | { kind: 'clear-outbox' }
  | { kind: 'clear-outbox-ack' }
  | { kind: 'broadcast-event'; event: TabMeshEvent }
  | { kind: 'ping'; tabId: string }
  | { kind: 'pong'; tabId: string }
  | { kind: 'lifecycle'; tabId: string; state: TabVisibilityState }
  | { kind: 'leader-elected'; tabId: string; term: number }
  | { kind: 'system-event'; event: TabMeshEvent }
  | { kind: 'transport-config'; config: WorkerTransportConfig }
  | { kind: 'transport-disconnect' };

/**
 * The abstraction boundary between TabMesh and the hub implementation.
 * Both SharedWorker and Elected Leader implement the same interface.
 */
export interface Hub {
  /** Connect this tab to the hub. */
  connect(tabId: string): Promise<void>;
  /** Disconnect this tab from the hub. */
  disconnect(): Promise<void>;
  /** Submit an outbound event to the hub for delivery. */
  submit(entry: OutboxEntry): Promise<void>;
  /** Clear all events from the outbox. */
  clearOutbox(): Promise<void>;
  /** Broadcast an event to other tabs without persisting to the outbox. */
  broadcastToTabs(event: TabMeshEvent): void;
  /** Register a handler for inbound events from the hub. */
  onEvent(handler: (event: TabMeshEvent) => void): void;
  /** Register a handler for system events. */
  onSystemEvent(handler: (event: TabMeshEvent) => void): void;
  /** Whether this tab is currently connected to the hub. */
  readonly connected: boolean;
  /**
   * Tear down the backend transport without disconnecting from the hub.
   * Used during the logout flow so a stale auth token can't be replayed.
   * Optional — hubs that don't own a transport may omit this.
   */
  disconnectTransport?(): Promise<void>;

  /**
   * Best-effort drain of pending outbox events before disconnect. Called
   * from {@link TabMesh.stop} with a short deadline; the hub should
   * resolve when it has either drained or hit the deadline.
   */
  flush?(timeoutMs: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Reconnection configuration for the transport. */
export interface ReconnectConfig {
  /** Maximum number of reconnection attempts. @default 10 */
  maxAttempts: number;
  /** Initial delay in ms before the first retry. @default 1000 */
  initialDelayMs: number;
  /** Multiplier applied to the delay after each attempt. @default 2 */
  backoffMultiplier: number;
  /** Maximum delay in ms. @default 30000 */
  maxDelayMs: number;
}

/** Leader election configuration. */
export interface LeaderConfig {
  /**
   * Election strategy. `'auto'` detects Web Locks API support and falls back.
   * @default 'auto'
   */
  strategy: 'auto' | 'web-locks' | 'broadcast-heartbeat' | 'indexeddb-heartbeat';
}

/** Persistence (Outbox) configuration. */
export interface PersistenceConfig {
  /** IndexedDB database name. @default `tabmesh:{channelName}` */
  dbName?: string;
  /** Default TTL for events in ms. @default 86400000 (24 hours) */
  defaultTTL: number;
  /** Maximum number of events in the outbox. @default 1000 */
  maxQueueSize: number;
}

/** Service Worker configuration. */
export interface ServiceWorkerConfig {
  /** Enable Service Worker integration. @default false */
  enabled: boolean;
  /** Service Worker script URL. @default '/tabmesh-sw.js' */
  scriptUrl: string;
}

/**
 * TabMesh configuration options.
 *
 * @example Minimal configuration
 * ```typescript
 * const mesh = new TabMesh({ channelName: 'my-app' });
 * ```
 *
 * @example Full configuration
 * ```typescript
 * const mesh = new TabMesh({
 *   channelName: 'my-app',
 *   transport: new WebSocketTransport({ url: 'wss://api.example.com' }),
 * });
 * ```
 */
export interface TabMeshConfig {
  /**
   * App-level identifier that scopes the SharedWorker, IndexedDB database,
   * and BroadcastChannel. Should incorporate session identity to prevent
   * cross-session event leakage.
   *
   * @example 'my-app' or 'app:{tenantId}:{userId}'
   */
  channelName: string;

  /** Optional transport for backend communication. */
  transport?: Transport;

  /**
   * URL of the SharedWorker script. Used only when the SharedWorker hub
   * is selected. Defaults to `/tabmesh-worker.js`.
   */
  workerUrl?: string;

  /** Leader election configuration (used only in fallback mode). */
  leader?: Partial<LeaderConfig>;

  /** Persistence / Outbox configuration. */
  persistence?: Partial<PersistenceConfig>;

  /** Reconnection configuration for the transport. */
  reconnect?: Partial<ReconnectConfig>;

  /** Service Worker configuration. */
  serviceWorker?: Partial<ServiceWorkerConfig>;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** The current role of this tab. */
export type TabRole = 'hub' | 'follower';

/** The hub mode in use. */
export type HubMode = 'shared-worker' | 'elected-leader' | 'degraded';

/** Transport connection state. */
export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Overall mesh status. */
export interface TabMeshStatus {
  /** Whether `start()` has been called and the mesh is running. */
  started: boolean;
  /** The hub mode in use. */
  hubMode: HubMode | null;
  /** Whether this tab is connected to the hub. */
  hubConnected: boolean;
  /** This tab's role. */
  role: TabRole | null;
  /** Transport connection state. */
  transportState: TransportState;
  /** This tab's unique ID. */
  tabId: string;
  /** Whether persistence is degraded (in-memory fallback). */
  degraded: boolean;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Event handler function. */
export type EventHandler<T = unknown> = (event: TabMeshEvent<T>) => void;

/** Unsubscribe function returned by `mesh.on()`. */
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// System Events
// ---------------------------------------------------------------------------

/** All system event types emitted by TabMesh. */
export type SystemEventType =
  | 'hub.connected'
  | 'hub.disconnected'
  | 'transport.connected'
  | 'transport.disconnected'
  | 'transport.reconnecting'
  | 'transport.error'
  | 'event.delivery.failed'
  | 'storage.degraded';

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

/** Current protocol version for SharedWorker ↔ tab handshake. */
export const PROTOCOL_VERSION = 1;
