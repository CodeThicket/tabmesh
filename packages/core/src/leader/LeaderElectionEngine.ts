/**
 * Leader Election Engine with layered fallback.
 *
 * Strategy selection (once at startup, based on browser capabilities):
 * 1. Web Locks API — sub-50ms failover
 * 2. BroadcastChannel heartbeat — ~1-2s failover
 * 3. IndexedDB heartbeat — ~2-5s failover
 *
 * Only one strategy runs at a time.
 */

import type { LeaderConfig } from '../types.js';

/** Callbacks for leader election state changes. */
export interface LeaderElectionCallbacks {
  onBecomeLeader: (term: number) => void;
  onBecomeFollower: (leaderTabId: string, term: number) => void;
  onLeaderChanged: (leaderTabId: string, term: number) => void;
}

type Strategy = 'web-locks' | 'broadcast-heartbeat' | 'indexeddb-heartbeat';

/**
 * LeaderElectionEngine elects a single leader tab within a channel.
 *
 * The elected leader is responsible for holding the Transport connection
 * and draining the Event Outbox (in fallback mode).
 */
export class LeaderElectionEngine {
  private readonly channelName: string;
  private readonly tabId: string;
  private readonly callbacks: LeaderElectionCallbacks;
  private strategy: Strategy | null = null;
  private running = false;
  private isLeader = false;
  private currentTerm = 0;
  private currentLeaderTabId: string | null = null;

  // Web Locks
  private lockAbortController: AbortController | null = null;

  // BroadcastChannel heartbeat
  private bcChannel: BroadcastChannel | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private leaderTimeout: ReturnType<typeof setTimeout> | null = null;

  // IndexedDB heartbeat
  private idbHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private idbCheckInterval: ReturnType<typeof setInterval> | null = null;
  private idbDbName: string;

  constructor(
    channelName: string,
    tabId: string,
    callbacks: LeaderElectionCallbacks,
    config?: Partial<LeaderConfig>
  ) {
    this.channelName = channelName;
    this.tabId = tabId;
    this.callbacks = callbacks;
    this.idbDbName = `tabmesh-leader:${channelName}`;
    this.strategy = this.selectStrategy(config?.strategy ?? 'auto');
  }

  /** The selected election strategy. */
  get activeStrategy(): Strategy | null {
    return this.strategy;
  }

  /** Whether this tab is currently the leader. */
  get leader(): boolean {
    return this.isLeader;
  }

  /** The current leader's tab ID, if known. */
  get leaderTabId(): string | null {
    return this.currentLeaderTabId;
  }

  /** The current monotonic term number. */
  get term(): number {
    return this.currentTerm;
  }

  /** Start the election process. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    switch (this.strategy) {
      case 'web-locks':
        await this.startWebLocks();
        break;
      case 'broadcast-heartbeat':
        this.startBroadcastHeartbeat();
        break;
      case 'indexeddb-heartbeat':
        await this.startIndexedDBHeartbeat();
        break;
    }
  }

  /** Stop the election process and release leadership. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.isLeader = false;

    // Web Locks cleanup
    if (this.lockAbortController) {
      this.lockAbortController.abort();
      this.lockAbortController = null;
    }

    // BroadcastChannel cleanup
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.leaderTimeout) {
      clearTimeout(this.leaderTimeout);
      this.leaderTimeout = null;
    }
    if (this.bcChannel) {
      this.bcChannel.close();
      this.bcChannel = null;
    }

    // IndexedDB cleanup
    if (this.idbHeartbeatInterval) {
      clearInterval(this.idbHeartbeatInterval);
      this.idbHeartbeatInterval = null;
    }
    if (this.idbCheckInterval) {
      clearInterval(this.idbCheckInterval);
      this.idbCheckInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Strategy selection
  // ---------------------------------------------------------------------------

  private selectStrategy(preference: LeaderConfig['strategy']): Strategy {
    if (preference !== 'auto') {
      return preference;
    }

    // Check Web Locks API availability
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return 'web-locks';
    }

    // Check BroadcastChannel availability
    if (typeof BroadcastChannel !== 'undefined') {
      return 'broadcast-heartbeat';
    }

    // Fallback to IndexedDB
    return 'indexeddb-heartbeat';
  }

  // ---------------------------------------------------------------------------
  // Web Locks API strategy
  // ---------------------------------------------------------------------------

  private async startWebLocks(): Promise<void> {
    const lockName = `tabmesh-leader:${this.channelName}`;
    this.lockAbortController = new AbortController();

    // Request the lock - this will block until the lock is acquired.
    // When another tab holding the lock closes, this tab acquires it.
    // The lock is held as long as the Promise passed to the callback is pending.
    navigator.locks
      .request(lockName, { signal: this.lockAbortController.signal }, async () => {
        // We acquired the lock - we are the leader
        if (!this.running) return;

        this.currentTerm++;
        this.isLeader = true;
        this.currentLeaderTabId = this.tabId;
        this.callbacks.onBecomeLeader(this.currentTerm);

        // Hold the lock until we stop or the tab closes
        return new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (!this.running) {
              clearInterval(check);
              resolve();
            }
          }, 100);
        });
      })
      .catch((err: unknown) => {
        // AbortError is expected when stop() is called
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        // If we failed to get the lock, we're a follower
        if (this.running) {
          this.isLeader = false;
          // We don't know the leader's tab ID in this strategy
        }
      });

    // Give a brief moment for lock acquisition
    await new Promise((r) => setTimeout(r, 50));

    if (!this.isLeader && this.running) {
      this.callbacks.onBecomeFollower(this.currentLeaderTabId ?? 'unknown', this.currentTerm);
    }
  }

  // ---------------------------------------------------------------------------
  // BroadcastChannel heartbeat strategy
  // ---------------------------------------------------------------------------

  private startBroadcastHeartbeat(): void {
    const bcName = `tabmesh-leader-election:${this.channelName}`;
    this.bcChannel = new BroadcastChannel(bcName);

    type ElectionMessage =
      | { type: 'heartbeat'; tabId: string; term: number }
      | { type: 'leader-elected'; tabId: string; term: number };

    this.bcChannel.onmessage = (event: MessageEvent<ElectionMessage>) => {
      const msg = event.data;

      if (msg.type === 'heartbeat' || msg.type === 'leader-elected') {
        if (
          msg.term > this.currentTerm ||
          (msg.term === this.currentTerm && msg.tabId < this.tabId)
        ) {
          // Another tab has higher term or wins tiebreaker
          if (this.isLeader) {
            this.demote(msg.tabId, msg.term);
          }
          this.currentTerm = msg.term;
          this.currentLeaderTabId = msg.tabId;
          this.resetLeaderTimeout();
        }
      }
    };

    // Start by assuming we might be leader - wait for silence
    this.resetLeaderTimeout();
  }

  private resetLeaderTimeout(): void {
    if (this.leaderTimeout) {
      clearTimeout(this.leaderTimeout);
    }

    // If no heartbeat received within 1.5s, declare ourselves leader
    this.leaderTimeout = setTimeout(() => {
      if (!this.running) return;
      this.becomeLeader();
    }, 1500);
  }

  private becomeLeader(): void {
    this.currentTerm++;
    this.isLeader = true;
    this.currentLeaderTabId = this.tabId;

    // Start broadcasting heartbeats
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.broadcastHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.isLeader && this.running) {
        this.broadcastHeartbeat();
      }
    }, 500);

    this.callbacks.onBecomeLeader(this.currentTerm);
  }

  private broadcastHeartbeat(): void {
    if (this.bcChannel) {
      this.bcChannel.postMessage({
        type: 'heartbeat',
        tabId: this.tabId,
        term: this.currentTerm,
      });
    }
  }

  private demote(leaderTabId: string, term: number): void {
    this.isLeader = false;
    this.currentLeaderTabId = leaderTabId;
    this.currentTerm = term;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.callbacks.onBecomeFollower(leaderTabId, term);
    this.resetLeaderTimeout();
  }

  // ---------------------------------------------------------------------------
  // IndexedDB heartbeat strategy
  // ---------------------------------------------------------------------------

  private async startIndexedDBHeartbeat(): Promise<void> {
    // Write our candidacy
    await this.idbWriteHeartbeat();

    // Check for existing leader
    const existingLeader = await this.idbReadLeader();
    if (existingLeader && existingLeader.tabId !== this.tabId) {
      const age = Date.now() - existingLeader.timestamp;
      if (age < 5000) {
        // Leader is alive
        this.isLeader = false;
        this.currentLeaderTabId = existingLeader.tabId;
        this.currentTerm = existingLeader.term;
        this.callbacks.onBecomeFollower(existingLeader.tabId, existingLeader.term);
        this.startIdbChecking();
        return;
      }
    }

    // No active leader - claim leadership
    this.currentTerm++;
    this.isLeader = true;
    this.currentLeaderTabId = this.tabId;
    await this.idbWriteLeader();
    this.callbacks.onBecomeLeader(this.currentTerm);

    // Start heartbeat writes
    this.idbHeartbeatInterval = setInterval(async () => {
      if (this.isLeader && this.running) {
        await this.idbWriteLeader();
      }
    }, 2000);

    this.startIdbChecking();
  }

  private startIdbChecking(): void {
    // Periodically check if leader is still alive
    this.idbCheckInterval = setInterval(async () => {
      if (!this.running) return;

      const leader = await this.idbReadLeader();
      if (!leader || Date.now() - leader.timestamp > 5000) {
        // Leader is dead - attempt to claim
        if (!this.isLeader) {
          this.currentTerm++;
          this.isLeader = true;
          this.currentLeaderTabId = this.tabId;
          await this.idbWriteLeader();
          this.callbacks.onBecomeLeader(this.currentTerm);

          if (this.idbHeartbeatInterval) clearInterval(this.idbHeartbeatInterval);
          this.idbHeartbeatInterval = setInterval(async () => {
            if (this.isLeader && this.running) {
              await this.idbWriteLeader();
            }
          }, 2000);
        }
      } else if (leader.tabId !== this.tabId && this.isLeader) {
        // Someone else is leader with a higher term
        if (leader.term >= this.currentTerm) {
          this.isLeader = false;
          this.currentLeaderTabId = leader.tabId;
          this.currentTerm = leader.term;
          if (this.idbHeartbeatInterval) {
            clearInterval(this.idbHeartbeatInterval);
            this.idbHeartbeatInterval = null;
          }
          this.callbacks.onBecomeFollower(leader.tabId, leader.term);
        }
      }
    }, 2500);
  }

  private async idbWriteLeader(): Promise<void> {
    try {
      const db = await this.openLeaderDb();
      const tx = db.transaction('leader', 'readwrite');
      const store = tx.objectStore('leader');
      store.put({
        id: 'current',
        tabId: this.tabId,
        term: this.currentTerm,
        timestamp: Date.now(),
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      // IndexedDB write failed - continue operating
    }
  }

  private async idbWriteHeartbeat(): Promise<void> {
    await this.idbWriteLeader();
  }

  private async idbReadLeader(): Promise<{
    tabId: string;
    term: number;
    timestamp: number;
  } | null> {
    try {
      const db = await this.openLeaderDb();
      const tx = db.transaction('leader', 'readonly');
      const store = tx.objectStore('leader');
      const request = store.get('current');
      const result = await new Promise<{
        tabId: string;
        term: number;
        timestamp: number;
      } | null>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return result;
    } catch {
      return null;
    }
  }

  private openLeaderDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.idbDbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('leader')) {
          db.createObjectStore('leader', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
