"use strict";
(() => {
  // ../core/src/service-worker/tabmesh-sw.ts
  var config = null;
  var STORE_NAME = "events";
  var SYNC_TAG_PREFIX = "tabmesh-sync:";
  self.oninstall = (event) => {
    event.waitUntil(self.skipWaiting());
  };
  self.onactivate = (event) => {
    event.waitUntil(self.clients.claim());
  };
  self.onmessage = (event) => {
    const data = event.data;
    if (data.kind === "tabmesh-sw-config" && data.config) {
      config = data.config;
    }
  };
  self.onsync = (event) => {
    if (!event.tag.startsWith(SYNC_TAG_PREFIX)) return;
    event.waitUntil(drainPendingEvents());
  };
  function openDatabase(dbName) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function drainPendingEvents() {
    if (!config) return;
    let db;
    try {
      db = await openDatabase(config.dbName);
    } catch {
      return;
    }
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("status");
      const pending = await promisify(index.getAll("pending"));
      const now = Date.now();
      const deliveredIds = [];
      const expiredIds = [];
      pending.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
      const canDeliver = Boolean(config.deliveryUrl);
      for (const entry of pending) {
        if (entry.expiresAt !== void 0 && entry.expiresAt <= now) {
          expiredIds.push(entry.id);
          continue;
        }
        if (!canDeliver) continue;
        try {
          const response = await fetch(config.deliveryUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: entry.type,
              payload: entry.payload,
              id: entry.id,
              sourceTabId: entry.sourceTabId
            })
          });
          if (response.ok) {
            deliveredIds.push(entry.id);
          }
        } catch {
        }
      }
      const cleanupTx = db.transaction(STORE_NAME, "readwrite");
      const cleanupStore = cleanupTx.objectStore(STORE_NAME);
      for (const id of [...deliveredIds, ...expiredIds]) {
        cleanupStore.delete(id);
      }
      await new Promise((resolve, reject) => {
        cleanupTx.oncomplete = () => resolve();
        cleanupTx.onerror = () => reject(cleanupTx.error);
      });
    } finally {
      db.close();
    }
  }
  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
})();
