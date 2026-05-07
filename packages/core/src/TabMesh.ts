/**
 * TabMesh — the core orchestrator.
 *
 * A hub-and-spoke event system that multiplexes a single backend transport
 * across multiple browser tabs within the same origin.
 *
 * @example Basic usage
 * ```typescript
 * import { TabMesh } from '@tabmesh/core';
 *
 * const mesh = new TabMesh({ channelName: 'my-app' });
 * await mesh.start();
 *
 * await mesh.send({ type: 'chat.message', payload: { text: 'Hello!' } });
 * mesh.on('chat.message', (event) => console.log(event.payload.text));
 * ```
 *
 * @example With WebSocket transport
 * ```typescript
 * import { TabMesh } from '@tabmesh/core';
 * import { WebSocketTransport } from '@tabmesh/transport-websocket';
 *
 * const mesh = new TabMesh({
 *   channelName: 'my-app',
 *   transport: new WebSocketTransport({ url: 'wss://api.example.com' }),
 * });
 * ```
 */

import { ErrorCode, TabMeshError } from './errors.js';
import { ElectedLeaderHub } from './hub/ElectedLeaderHub.js';
import { SharedWorkerHub } from './hub/SharedWorkerHub.js';
import { ServiceWorkerClient } from './service-worker/ServiceWorkerClient.js';
import { EventIdGenerator, getTabId } from './tab-id.js';
import type {
  EventHandler,
  Hub,
  HubMode,
  OutboundEvent,
  OutboxEntry,
  SystemEventType,
  TabMeshConfig,
  TabMeshEvent,
  TabMeshStatus,
  TransportState,
  Unsubscribe,
} from './types.js';

/**
 * TabMesh is the main entry point for the library.
 *
 * It orchestrates the Hub (SharedWorker or Elected Leader), Transport,
 * Outbox, and event subscriptions.
 */
export class TabMesh {
  private readonly config: TabMeshConfig;
  private readonly tabId: string;
  private readonly idGenerator: EventIdGenerator;
  private hub: Hub | null = null;
  private hubMode: HubMode | null = null;
  private started = false;
  private stopped = false;
  private transportState: TransportState = 'disconnected';
  private degraded = false;

  /** Event subscriptions keyed by event type. '*' for wildcard. */
  private handlers = new Map<string, Set<EventHandler>>();

  /** Pre-start event buffer. */
  private buffer: OutboundEvent[] = [];

  /** Ping interval for SharedWorker hub keepalive. */
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  /** Service Worker client for background sync. */
  private swClient: ServiceWorkerClient | null = null;

  constructor(config: TabMeshConfig) {
    this.config = config;
    this.tabId = getTabId(config.channelName);
    this.idGenerator = new EventIdGenerator(this.tabId);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start the mesh. Connects to the Hub, initializes Transport (if configured),
   * and flushes any pre-start buffered events.
   *
   * Resolves successfully even if the Transport fails — the mesh operates
   * in transport-less mode and retries in the background.
   */
  async start(): Promise<void> {
    if (this.stopped) {
      throw new TabMeshError(
        'Cannot start a stopped TabMesh instance. Create a new instance.',
        ErrorCode.ALREADY_STOPPED,
        { channelName: this.config.channelName }
      );
    }
    if (this.started) {
      throw new TabMeshError('TabMesh is already started.', ErrorCode.ALREADY_STARTED, {
        channelName: this.config.channelName,
      });
    }

    // Select and connect hub
    this.hub = this.createHub();
    this.hub.onEvent((event) => this.dispatchEvent(event));
    this.hub.onSystemEvent((event) => this.handleSystemEvent(event));

    await this.hub.connect(this.tabId);
    this.started = true;

    // Start keepalive ping for SharedWorker
    if (this.hub instanceof SharedWorkerHub) {
      this.pingInterval = setInterval(() => {
        (this.hub as SharedWorkerHub).sendPing();
      }, 10_000);
    }

    // Register Service Worker if configured
    if (this.config.serviceWorker?.enabled) {
      this.swClient = new ServiceWorkerClient(this.config.channelName, this.config.serviceWorker);
      // Non-blocking — registration failure is non-fatal
      this.swClient.register().catch(() => {});
    }

    // Listen for visibility changes
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // Emit hub connected system event
    this.dispatchEvent({
      type: 'hub.connected',
      payload: { tabId: this.tabId, hubMode: this.hubMode },
      source: 'local',
      meta: {
        internalSource: this.hubMode === 'shared-worker' ? 'port' : 'broadcast',
        sourceTabId: this.tabId,
        eventId: '',
        createdAt: Date.now(),
      },
    });

    // Flush pre-start buffer
    const buffered = this.buffer;
    this.buffer = [];
    for (const event of buffered) {
      await this.send(event);
    }
  }

  /**
   * Stop the mesh. Disconnects from the Hub and flushes pending events
   * with a short timeout.
   *
   * Does not clear the Outbox — stale events expire via TTL.
   */
  async stop(): Promise<void> {
    if (!this.started || this.stopped) return;

    this.stopped = true;
    this.started = false;

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // Request background sync before disconnecting hub
    if (this.swClient) {
      await this.swClient.requestSync().catch(() => {});
    }

    if (this.hub) {
      await this.hub.disconnect();
      this.hub = null;
    }

    this.handlers.clear();
  }

  /**
   * Send an event through the mesh.
   *
   * If called before `start()`, the event is buffered and sent when
   * `start()` completes. The promise resolves when the Hub acknowledges
   * receipt (primary) or the Outbox write succeeds (fallback).
   *
   * @template T - The payload type
   * @param event - The outbound event to send
   */
  async send<T = unknown>(event: OutboundEvent<T>): Promise<void> {
    if (this.stopped) {
      throw new TabMeshError(
        'Cannot send events on a stopped TabMesh instance.',
        ErrorCode.ALREADY_STOPPED,
        { channelName: this.config.channelName }
      );
    }

    // Buffer if not started yet
    if (!this.started || !this.hub) {
      this.buffer.push(event as OutboundEvent);
      return;
    }

    const now = Date.now();
    const eventId = this.idGenerator.next();
    const priority = event.priority ?? 0;

    const entry: OutboxEntry = {
      id: eventId,
      type: event.type,
      payload: event.payload,
      priority,
      expiresAt: event.ttl ? now + event.ttl : undefined,
      createdAt: now,
      status: 'pending',
      sourceTabId: this.tabId,
    };

    await this.hub.submit(entry);
  }

  /**
   * Register an event handler for a specific event type.
   *
   * @template T - The payload type
   * @param eventType - The event type to listen for (e.g., 'chat.message')
   * @param handler - The handler function
   * @returns Unsubscribe function
   */
  on<T = unknown>(eventType: string, handler: EventHandler<T>): Unsubscribe {
    if (this.stopped) {
      throw new TabMeshError(
        'Cannot subscribe on a stopped TabMesh instance.',
        ErrorCode.ALREADY_STOPPED,
        { channelName: this.config.channelName }
      );
    }

    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    const captured = set;
    captured.add(handler as EventHandler);

    return () => {
      captured.delete(handler as EventHandler);
      if (captured.size === 0) {
        this.handlers.delete(eventType);
      }
    };
  }

  /**
   * Broadcast an event to all tabs without persisting to the Outbox
   * or sending via Transport.
   *
   * Used for ephemeral signals like `auth.logout`.
   */
  broadcast<T = unknown>(event: OutboundEvent<T>): void {
    if (!this.started || !this.hub) {
      throw new TabMeshError('Cannot broadcast before start().', ErrorCode.NOT_STARTED, {
        channelName: this.config.channelName,
      });
    }
    const tabMeshEvent: TabMeshEvent<T> = {
      type: event.type,
      payload: event.payload,
      source: 'local',
      meta: {
        internalSource: 'broadcast',
        sourceTabId: this.tabId,
        eventId: this.idGenerator.next(),
        createdAt: Date.now(),
      },
    };

    // Dispatch locally
    this.dispatchEvent(tabMeshEvent as TabMeshEvent);

    // Broadcast to other tabs via the hub
    this.hub.broadcastToTabs(tabMeshEvent as TabMeshEvent);
  }

  /**
   * Clear all events from the Outbox.
   * Call this during logout to prevent stale events from leaking.
   */
  async clearOutbox(): Promise<void> {
    if (this.hub) {
      await this.hub.clearOutbox();
    }
  }

  /**
   * Get the current status of the mesh.
   */
  getStatus(): TabMeshStatus {
    return {
      started: this.started,
      hubMode: this.hubMode,
      hubConnected: this.hub?.connected ?? false,
      role: this.hubMode === 'shared-worker' ? 'follower' : null,
      transportState: this.transportState,
      tabId: this.tabId,
      degraded: this.degraded,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private createHub(): Hub {
    // Try SharedWorker first
    if (typeof SharedWorker !== 'undefined') {
      this.hubMode = 'shared-worker';
      return new SharedWorkerHub(this.config.channelName);
    }

    // Fallback to Elected Leader
    this.hubMode = 'elected-leader';
    return new ElectedLeaderHub({
      channelName: this.config.channelName,
      transport: this.config.transport,
      persistence: this.config.persistence,
      reconnect: this.config.reconnect,
    });
  }

  private dispatchEvent(event: TabMeshEvent): void {
    // Dispatch to type-specific handlers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch {
          // Don't let one handler break others
        }
      }
    }

    // Dispatch to wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(event);
        } catch {
          // Don't let one handler break others
        }
      }
    }
  }

  private handleSystemEvent(event: TabMeshEvent): void {
    const type = event.type as SystemEventType;

    // Update internal state
    switch (type) {
      case 'transport.connected':
        this.transportState = 'connected';
        break;
      case 'transport.disconnected':
        this.transportState = 'disconnected';
        break;
      case 'transport.reconnecting':
        this.transportState = 'reconnecting';
        break;
      case 'storage.degraded':
        this.degraded = true;
        break;
    }

    // System events are dispatched like regular events
    this.dispatchEvent(event);
  }

  private handleVisibilityChange = (): void => {
    if (this.hub instanceof SharedWorkerHub) {
      const state = document.visibilityState === 'visible' ? 'visible' : 'hidden';
      this.hub.sendLifecycle(state);
    }
  };
}
