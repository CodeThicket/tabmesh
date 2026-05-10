/**
 * Elected Leader Hub — Fallback mode.
 *
 * For browsers without SharedWorker. One tab is elected Leader via the
 * LeaderElectionEngine. The Leader holds the Transport and relays events
 * via BroadcastChannel.
 *
 * Tabs write to the Outbox directly (write-through), then notify the
 * Leader via BroadcastChannel. The Leader drains and delivers.
 */

import { EventBus } from '../bus/EventBus.js';
import { LeaderElectionEngine } from '../leader/LeaderElectionEngine.js';
import { EventOutbox } from '../storage/EventOutbox.js';
import { TransportManager } from '../transport/TransportManager.js';
import type {
  Hub,
  OutboxEntry,
  PersistenceConfig,
  ReconnectConfig,
  TabMeshEvent,
  Transport,
} from '../types.js';

/** Configuration for the ElectedLeaderHub. */
export interface ElectedLeaderHubConfig {
  channelName: string;
  transport?: Transport;
  persistence?: Partial<PersistenceConfig>;
  reconnect?: Partial<ReconnectConfig>;
}

/**
 * ElectedLeaderHub uses BroadcastChannel for cross-tab messaging and
 * leader election to designate a single hub tab.
 */
export class ElectedLeaderHub implements Hub {
  private readonly config: ElectedLeaderHubConfig;
  private bus: EventBus | null = null;
  private outbox: EventOutbox | null = null;
  private leader: LeaderElectionEngine | null = null;
  private transportManager: TransportManager | null = null;
  private eventHandler: ((event: TabMeshEvent) => void) | null = null;
  private systemEventHandler: ((event: TabMeshEvent) => void) | null = null;
  private _connected = false;
  private tabId: string | null = null;
  private drainScheduled = false;
  private cleanupFns: (() => void)[] = [];

  // Echo suppression: ids the leader forwarded to the transport. If the server
  // bounces a message back with the same id, drop it so the originating tab
  // does not see its own event a second time.
  private readonly sentIds = new Map<string, number>();
  private static readonly SENT_ID_TTL_MS = 60_000;
  private static readonly SENT_ID_MAX = 1000;

  /** Batch window for outbox writes (ms). */
  private static readonly BATCH_WINDOW_MS = 50;

  constructor(config: ElectedLeaderHubConfig) {
    this.config = config;
  }

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Snapshot of the current leader-election state. Returns `null` if the
   * hub hasn't started electing yet. Used by TabMesh.getStatus().
   */
  getElectionSnapshot(): { isLeader: boolean; leaderTabId: string | null; term: number } | null {
    if (!this.leader) return null;
    return {
      isLeader: this.leader.leader,
      leaderTabId: this.leader.leaderTabId,
      term: this.leader.term,
    };
  }

  async connect(tabId: string): Promise<void> {
    this.tabId = tabId;

    // Initialize the EventBus
    this.bus = new EventBus(this.config.channelName);
    this.bus.open();

    // Initialize the Outbox
    this.outbox = new EventOutbox(this.config.channelName, this.config.persistence);
    const { degraded } = await this.outbox.open();

    if (degraded) {
      this.emitSystemEvent('storage.degraded', { reason: 'indexeddb_unavailable' });
    }

    // Initialize leader election
    this.leader = new LeaderElectionEngine(this.config.channelName, tabId, {
      onBecomeLeader: (term) => this.onBecomeLeader(term),
      onBecomeFollower: (leaderTabId, term) => this.onBecomeFollower(leaderTabId, term),
      onLeaderChanged: (leaderTabId, term) => this.onLeaderChanged(leaderTabId, term),
    });

    // Listen for events and flush notifications on BroadcastChannel
    const unsubEvent = this.bus.on('event', (msg) => {
      if (msg.kind === 'event') {
        this.eventHandler?.(msg.event);
      }
    });
    this.cleanupFns.push(unsubEvent);

    const unsubSystem = this.bus.on('system-event', (msg) => {
      if (msg.kind === 'system-event') {
        this.systemEventHandler?.(msg.event);
      }
    });
    this.cleanupFns.push(unsubSystem);

    const unsubFlush = this.bus.on('outbox-flush', () => {
      if (this.leader?.leader) {
        this.scheduleDrain();
      }
    });
    this.cleanupFns.push(unsubFlush);

    // Start leader election
    await this.leader.start();

    this._connected = true;
    this.emitSystemEvent('hub.connected', {});
  }

  async disconnect(): Promise<void> {
    this._connected = false;

    // Cleanup in reverse order
    if (this.transportManager) {
      await this.transportManager.disconnect();
      this.transportManager = null;
    }

    if (this.leader) {
      await this.leader.stop();
      this.leader = null;
    }

    for (const fn of this.cleanupFns) {
      fn();
    }
    this.cleanupFns = [];

    if (this.bus) {
      this.bus.close();
      this.bus = null;
    }

    if (this.outbox) {
      this.outbox.close();
      this.outbox = null;
    }

    this.emitSystemEvent('hub.disconnected', {});
  }

  async submit(entry: OutboxEntry): Promise<void> {
    if (!this.outbox) {
      throw new Error('Not connected to hub');
    }

    // In fallback mode, tabs write to outbox directly
    await this.outbox.put(entry);

    // Notify the leader to drain
    if (this.bus?.isOpen) {
      this.bus.broadcast({ kind: 'outbox-flush' });
    }

    // If we are the leader, schedule a drain
    if (this.leader?.leader) {
      this.scheduleDrain();
    }
  }

  async clearOutbox(): Promise<void> {
    if (this.outbox) {
      await this.outbox.clear();
    }
  }

  broadcastToTabs(event: TabMeshEvent): void {
    if (this.bus?.isOpen) {
      this.bus.broadcastAndDispatchLocally({ kind: 'event', event });
    }
  }

  onEvent(handler: (event: TabMeshEvent) => void): void {
    this.eventHandler = handler;
  }

  onSystemEvent(handler: (event: TabMeshEvent) => void): void {
    this.systemEventHandler = handler;
  }

  async disconnectTransport(): Promise<void> {
    if (this.transportManager) {
      await this.transportManager.disconnect();
      this.transportManager = null;
      this.emitSystemEvent('transport.disconnected', { reason: 'explicit' });
    }
  }

  async flush(timeoutMs: number): Promise<void> {
    // If we are the leader, drain immediately; otherwise nudge the leader
    // via BroadcastChannel and give it a brief window to finish.
    if (this.leader?.leader) {
      await Promise.race([this.drain(), new Promise((r) => setTimeout(r, timeoutMs))]);
      return;
    }
    if (this.bus?.isOpen) {
      this.bus.broadcast({ kind: 'outbox-flush' });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  }

  // ---------------------------------------------------------------------------
  // Leader election callbacks
  // ---------------------------------------------------------------------------

  private onBecomeLeader(term: number): void {
    // Announce leadership
    if (this.bus?.isOpen && this.tabId) {
      this.bus.broadcastAndDispatchLocally({
        kind: 'leader-elected',
        tabId: this.tabId,
        term,
      });
    }

    // Connect transport if configured
    if (this.config.transport && !this.transportManager) {
      this.transportManager = new TransportManager(
        this.config.transport,
        {
          onMessage: (data) => this.onTransportMessage(data),
          onConnected: () => this.emitSystemEvent('transport.connected', {}),
          onDisconnected: () => this.emitSystemEvent('transport.disconnected', {}),
          onReconnecting: (attempt, max) =>
            this.emitSystemEvent('transport.reconnecting', { attempt, maxAttempts: max }),
          onError: (error) => this.emitSystemEvent('transport.error', { message: error.message }),
          onSystemEvent: (event) => this.systemEventHandler?.(event),
        },
        this.config.reconnect
      );
      this.transportManager.connect().catch(() => {
        // Transport failure is non-fatal — operates in transport-less mode
      });
    }

    // Catch-up drain for stale events
    this.scheduleDrain();
  }

  private onBecomeFollower(_leaderTabId: string, _term: number): void {
    // Disconnect transport if we had one
    if (this.transportManager) {
      this.transportManager.disconnect().catch(() => {});
      this.transportManager = null;
    }
  }

  private onLeaderChanged(leaderTabId: string, term: number): void {
    this.onBecomeFollower(leaderTabId, term);
  }

  // ---------------------------------------------------------------------------
  // Outbox drain
  // ---------------------------------------------------------------------------

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;

    setTimeout(async () => {
      this.drainScheduled = false;
      await this.drain();
    }, ElectedLeaderHub.BATCH_WINDOW_MS);
  }

  private async drain(): Promise<void> {
    if (!this.outbox || !this.leader?.leader) return;

    const pending = await this.outbox.readPending();
    // Always fall through so `markDeliveredAndCleanup` runs the cleanup
    // pass even when there is nothing new to send (idle stop()).
    const deliveredIds: string[] = [];

    for (const entry of pending) {
      // Build the event to distribute
      const event: TabMeshEvent = {
        type: entry.type,
        payload: entry.payload,
        source: entry.sourceTabId === this.tabId ? 'local' : 'remote',
        meta: {
          internalSource: 'broadcast',
          sourceTabId: entry.sourceTabId,
          eventId: entry.id,
          createdAt: entry.createdAt,
        },
      };

      // Send via transport if available
      let transportSent = true;
      if (this.transportManager?.isConnected) {
        try {
          await this.transportManager.send(
            JSON.stringify({ type: entry.type, payload: entry.payload, id: entry.id })
          );
          this.rememberSent(entry.id);
        } catch {
          transportSent = false;
          this.emitSystemEvent('event.delivery.failed', {
            eventId: entry.id,
            reason: 'transport_send_failed',
          });
        }
      }

      // Distribute to other tabs via BroadcastChannel
      if (this.bus?.isOpen) {
        this.bus.broadcastAndDispatchLocally({ kind: 'event', event });
      }

      // Mark delivered if transport sent (or no transport configured)
      if (transportSent || !this.config.transport) {
        deliveredIds.push(entry.id);
      }
    }

    // Always run the cleanup transaction — it reclaims previously-delivered
    // and TTL-expired entries, even when nothing new was just sent.
    await this.outbox.markDeliveredAndCleanup(deliveredIds);
  }

  // ---------------------------------------------------------------------------
  // Transport message handling
  // ---------------------------------------------------------------------------

  private onTransportMessage(data: string): void {
    try {
      const parsed = JSON.parse(data) as { type: string; payload: unknown; id?: string };

      // Drop server echoes of our own outbound events.
      if (typeof parsed.id === 'string' && this.consumeIfSelf(parsed.id)) return;

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

      // Distribute to all tabs including this one
      if (this.bus?.isOpen) {
        this.bus.broadcastAndDispatchLocally({ kind: 'event', event });
      }
    } catch {
      // Malformed transport message — ignore
    }
  }

  private rememberSent(id: string): void {
    if (!id) return;
    this.sentIds.set(id, Date.now() + ElectedLeaderHub.SENT_ID_TTL_MS);
    if (this.sentIds.size > ElectedLeaderHub.SENT_ID_MAX) {
      const now = Date.now();
      for (const [k, exp] of this.sentIds) {
        if (exp < now) this.sentIds.delete(k);
        if (this.sentIds.size <= ElectedLeaderHub.SENT_ID_MAX) break;
      }
    }
  }

  private consumeIfSelf(id: string): boolean {
    if (!id) return false;
    const exp = this.sentIds.get(id);
    if (exp == null) return false;
    this.sentIds.delete(id);
    return exp >= Date.now();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private emitSystemEvent(type: string, payload: unknown): void {
    const event: TabMeshEvent = {
      type,
      payload,
      source: 'local',
      meta: {
        internalSource: 'broadcast',
        sourceTabId: this.tabId ?? '',
        eventId: '',
        createdAt: Date.now(),
      },
    };
    this.systemEventHandler?.(event);

    // Also broadcast system events to other tabs
    if (this.bus?.isOpen) {
      this.bus.broadcast({ kind: 'system-event', event });
    }
  }
}
