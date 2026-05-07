/**
 * IndexedDB-backed durable queue for outbound events.
 *
 * The Outbox stores events with `pending` status until the Hub marks them
 * `delivered` after successful Transport send or tab distribution.
 *
 * In primary mode (SharedWorker), only the Hub writes to the Outbox.
 * In fallback mode (Elected Leader), tabs write directly (write-through).
 */

import type { DeliveryStatus, OutboxEntry, PersistenceConfig } from '../types.js';

const STORE_NAME = 'events';
const DB_VERSION = 1;

/** Default persistence configuration. */
const DEFAULTS: PersistenceConfig = {
  defaultTTL: 86_400_000, // 24 hours
  maxQueueSize: 1000,
};

/**
 * EventOutbox provides IndexedDB-backed durable storage for outbound events.
 */
export class EventOutbox {
  private db: IDBDatabase | null = null;
  private readonly config: PersistenceConfig;
  private readonly dbName: string;
  private degraded = false;

  /** In-memory fallback queue when IndexedDB is unavailable. */
  private memoryQueue: OutboxEntry[] = [];

  constructor(channelName: string, config?: Partial<PersistenceConfig>) {
    this.config = { ...DEFAULTS, ...config };
    this.dbName = this.config.dbName ?? `tabmesh:${channelName}`;
  }

  /** Open the IndexedDB database. Falls back to in-memory if unavailable. */
  async open(): Promise<{ degraded: boolean }> {
    try {
      this.db = await this.openDatabase();
      return { degraded: false };
    } catch {
      this.degraded = true;
      return { degraded: true };
    }
  }

  /** Whether the outbox is using the in-memory fallback. */
  get isDegraded(): boolean {
    return this.degraded;
  }

  /** Add an event to the outbox with `pending` status. */
  async put(entry: OutboxEntry): Promise<void> {
    if (this.degraded) {
      if (this.memoryQueue.length >= this.config.maxQueueSize) {
        // Evict oldest delivered events, then oldest pending
        this.evictMemoryQueue();
      }
      this.memoryQueue.push(entry);
      return;
    }

    const tx = this.transaction('readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Check queue size
    const count = await this.promisify<number>(store.count());
    if (count >= this.config.maxQueueSize) {
      await this.evictIdb(store);
    }

    await this.promisify(store.put(entry));
  }

  /** Read all pending events, ordered by priority (descending) then createdAt. */
  async readPending(): Promise<OutboxEntry[]> {
    if (this.degraded) {
      const now = Date.now();
      return this.memoryQueue
        .filter((e) => e.status === 'pending' && (e.expiresAt === undefined || e.expiresAt > now))
        .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    }

    const tx = this.transaction('readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('status');
    const entries = await this.promisify<OutboxEntry[]>(index.getAll('pending'));
    const now = Date.now();

    return entries
      .filter((e) => e.expiresAt === undefined || e.expiresAt > now)
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
  }

  /**
   * Mark events as delivered and clean up in a single transaction.
   * Also deletes expired pending events and previously delivered events.
   */
  async markDeliveredAndCleanup(eventIds: string[]): Promise<void> {
    if (this.degraded) {
      const idSet = new Set(eventIds);
      const now = Date.now();
      // Mark delivered
      for (const entry of this.memoryQueue) {
        if (idSet.has(entry.id)) {
          entry.status = 'delivered';
        }
      }
      // Remove delivered and expired
      this.memoryQueue = this.memoryQueue.filter((e) => {
        if (e.status === 'delivered') return false;
        if (e.expiresAt !== undefined && e.expiresAt <= now) return false;
        return true;
      });
      return;
    }

    const tx = this.transaction('readwrite');
    const store = tx.objectStore(STORE_NAME);
    const all = await this.promisify<OutboxEntry[]>(store.getAll());
    const now = Date.now();
    const deliveredSet = new Set(eventIds);

    for (const entry of all) {
      if (deliveredSet.has(entry.id)) {
        // Mark as delivered and then delete
        await this.promisify(store.delete(entry.id));
      } else if (entry.status === 'delivered') {
        // Clean up previously delivered
        await this.promisify(store.delete(entry.id));
      } else if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        // Clean up expired pending
        await this.promisify(store.delete(entry.id));
      }
    }
  }

  /** Update a single entry's status. */
  async updateStatus(eventId: string, status: DeliveryStatus): Promise<void> {
    if (this.degraded) {
      const entry = this.memoryQueue.find((e) => e.id === eventId);
      if (entry) {
        entry.status = status;
      }
      return;
    }

    const tx = this.transaction('readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry = await this.promisify<OutboxEntry | undefined>(store.get(eventId));
    if (entry) {
      entry.status = status;
      await this.promisify(store.put(entry));
    }
  }

  /** Delete all events from the outbox. */
  async clear(): Promise<void> {
    if (this.degraded) {
      this.memoryQueue = [];
      return;
    }

    const tx = this.transaction('readwrite');
    const store = tx.objectStore(STORE_NAME);
    await this.promisify(store.clear());
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /** Get the number of entries in the outbox. */
  async count(): Promise<number> {
    if (this.degraded) {
      return this.memoryQueue.length;
    }
    const tx = this.transaction('readonly');
    const store = tx.objectStore(STORE_NAME);
    return this.promisify<number>(store.count());
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private transaction(mode: IDBTransactionMode): IDBTransaction {
    if (!this.db) {
      throw new Error('Database is not open');
    }
    return this.db.transaction(STORE_NAME, mode);
  }

  private promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private evictMemoryQueue(): void {
    // Remove delivered first, then oldest pending
    const deliveredIdx = this.memoryQueue.findIndex((e) => e.status === 'delivered');
    if (deliveredIdx >= 0) {
      this.memoryQueue.splice(deliveredIdx, 1);
      return;
    }
    // Remove oldest pending
    if (this.memoryQueue.length > 0) {
      this.memoryQueue.shift();
    }
  }

  private async evictIdb(store: IDBObjectStore): Promise<void> {
    // Delete oldest delivered events
    const statusIndex = store.index('status');
    const delivered = await this.promisify<OutboxEntry[]>(statusIndex.getAll('delivered'));
    if (delivered.length > 0) {
      delivered.sort((a, b) => a.createdAt - b.createdAt);
      const oldest = delivered[0];
      if (oldest) await this.promisify(store.delete(oldest.id));
      return;
    }
    // If no delivered, delete oldest pending
    const createdAtIndex = store.index('createdAt');
    const allByAge = await this.promisify<OutboxEntry[]>(createdAtIndex.getAll(undefined, 1));
    const oldestEntry = allByAge[0];
    if (oldestEntry) {
      await this.promisify(store.delete(oldestEntry.id));
    }
  }
}
