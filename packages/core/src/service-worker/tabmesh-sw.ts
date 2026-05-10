/**
 * TabMesh Service Worker script.
 *
 * Handles Background Sync to drain stale pending events from IndexedDB
 * when all tabs have closed. Deploy this file at a stable URL
 * (e.g., /tabmesh-sw.js).
 *
 * The Service Worker checks for stale `pending` events in IndexedDB
 * and attempts to deliver them via fetch(). This is a best-effort
 * fallback since `beforeunload` is unreliable on mobile.
 *
 * Usage:
 * ```typescript
 * const mesh = new TabMesh({
 *   channelName: 'my-app',
 *   transport: new WebSocketTransport({ url: 'wss://api.example.com' }),
 *   serviceWorker: { enabled: true, scriptUrl: '/tabmesh-sw.js' },
 * });
 * ```
 */

/** Service Worker global scope. */
interface SyncEvent extends ExtendableEvent {
  tag: string;
}

interface ServiceWorkerGlobalScopeExtended {
  onsync: ((event: SyncEvent) => void) | null;
  oninstall: ((event: ExtendableEvent) => void) | null;
  onactivate: ((event: ExtendableEvent) => void) | null;
  onmessage: ((event: ExtendableMessageEvent) => void) | null;
  skipWaiting(): Promise<void>;
  clients: Clients;
}

declare const self: ServiceWorkerGlobalScopeExtended;

// ---------------------------------------------------------------------------
// Configuration (received from the client via postMessage)
// ---------------------------------------------------------------------------

interface SWConfig {
  channelName: string;
  dbName: string;
  /** Optional HTTP endpoint to POST pending events to. */
  deliveryUrl?: string;
}

let config: SWConfig | null = null;

const STORE_NAME = 'events';
const SYNC_TAG_PREFIX = 'tabmesh-sync:';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.oninstall = (event) => {
  // Activate immediately without waiting for existing clients
  event.waitUntil(self.skipWaiting());
};

self.onactivate = (event) => {
  // Claim all clients so the SW takes effect immediately
  event.waitUntil(self.clients.claim());
};

// ---------------------------------------------------------------------------
// Message handling (configuration from TabMesh client)
// ---------------------------------------------------------------------------

self.onmessage = (event) => {
  const data = event.data as { kind: string; config?: SWConfig };
  if (data.kind === 'tabmesh-sw-config' && data.config) {
    config = data.config;
  }
};

// ---------------------------------------------------------------------------
// Background Sync handler
// ---------------------------------------------------------------------------

self.onsync = (event) => {
  if (!event.tag.startsWith(SYNC_TAG_PREFIX)) return;

  event.waitUntil(drainPendingEvents());
};

/**
 * Open the IndexedDB database used by TabMesh.
 */
function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Read all pending events from IndexedDB, filter expired, and attempt delivery.
 */
async function drainPendingEvents(): Promise<void> {
  if (!config) return;

  let db: IDBDatabase;
  try {
    db = await openDatabase(config.dbName);
  } catch {
    // IndexedDB unavailable in SW context — nothing to do
    return;
  }

  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('status');

    const pending = await promisify<
      Array<{
        id: string;
        type: string;
        payload: unknown;
        priority: number;
        expiresAt?: number;
        createdAt: number;
        status: string;
        sourceTabId: string;
      }>
    >(index.getAll('pending'));

    const now = Date.now();
    const deliveredIds: string[] = [];
    const expiredIds: string[] = [];

    // Sort by priority (desc), then createdAt (asc)
    pending.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

    // Without a delivery endpoint the SW has nothing to send to. Leave
    // pending entries in the outbox so the next Hub session picks them up;
    // we still GC TTL-expired entries below.
    const canDeliver = Boolean(config.deliveryUrl);

    for (const entry of pending) {
      // Filter expired events
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        expiredIds.push(entry.id);
        continue;
      }

      if (!canDeliver) continue;

      // Attempt delivery via fetch.
      try {
        const response = await fetch(config.deliveryUrl as string, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: entry.type,
            payload: entry.payload,
            id: entry.id,
            sourceTabId: entry.sourceTabId,
          }),
        });

        if (response.ok) {
          deliveredIds.push(entry.id);
        }
        // Non-OK response: leave as pending for next sync
      } catch {
        // Network failure: leave as pending for next sync
      }
    }

    // Cleanup in a new transaction
    const cleanupTx = db.transaction(STORE_NAME, 'readwrite');
    const cleanupStore = cleanupTx.objectStore(STORE_NAME);

    for (const id of [...deliveredIds, ...expiredIds]) {
      cleanupStore.delete(id);
    }

    await new Promise<void>((resolve, reject) => {
      cleanupTx.oncomplete = () => resolve();
      cleanupTx.onerror = () => reject(cleanupTx.error);
    });
  } finally {
    db.close();
  }
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
