"use strict";
(() => {
  // ../core/src/storage/EventOutbox.ts
  var STORE_NAME = "events";
  var DB_VERSION = 1;
  var DEFAULTS = {
    defaultTTL: 864e5,
    // 24 hours
    maxQueueSize: 1e3
  };
  var EventOutbox = class {
    constructor(channelName2, config) {
      this.db = null;
      this.degraded = false;
      /** In-memory fallback queue when IndexedDB is unavailable. */
      this.memoryQueue = [];
      this.config = { ...DEFAULTS, ...config };
      this.dbName = this.config.dbName ?? `tabmesh:${channelName2}`;
    }
    /** Open the IndexedDB database. Falls back to in-memory if unavailable. */
    async open() {
      try {
        this.db = await this.openDatabase();
        return { degraded: false };
      } catch {
        this.degraded = true;
        return { degraded: true };
      }
    }
    /** Whether the outbox is using the in-memory fallback. */
    get isDegraded() {
      return this.degraded;
    }
    /** Add an event to the outbox with `pending` status. */
    async put(entry) {
      if (this.degraded) {
        if (this.memoryQueue.length >= this.config.maxQueueSize) {
          this.evictMemoryQueue();
        }
        this.memoryQueue.push(entry);
        return;
      }
      const tx = this.transaction("readwrite");
      const store = tx.objectStore(STORE_NAME);
      const count = await this.promisify(store.count());
      if (count >= this.config.maxQueueSize) {
        await this.evictIdb(store);
      }
      await this.promisify(store.put(entry));
    }
    /** Read all pending events, ordered by priority (descending) then createdAt. */
    async readPending() {
      if (this.degraded) {
        const now2 = Date.now();
        return this.memoryQueue.filter((e) => e.status === "pending" && (e.expiresAt === void 0 || e.expiresAt > now2)).sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
      }
      const tx = this.transaction("readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("status");
      const entries = await this.promisify(index.getAll("pending"));
      const now = Date.now();
      return entries.filter((e) => e.expiresAt === void 0 || e.expiresAt > now).sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    }
    /**
     * Mark events as delivered and clean up in a single transaction.
     * Also deletes expired pending events and previously delivered events.
     */
    async markDeliveredAndCleanup(eventIds) {
      if (this.degraded) {
        const idSet = new Set(eventIds);
        const now2 = Date.now();
        for (const entry of this.memoryQueue) {
          if (idSet.has(entry.id)) {
            entry.status = "delivered";
          }
        }
        this.memoryQueue = this.memoryQueue.filter((e) => {
          if (e.status === "delivered") return false;
          if (e.expiresAt !== void 0 && e.expiresAt <= now2) return false;
          return true;
        });
        return;
      }
      const tx = this.transaction("readwrite");
      const store = tx.objectStore(STORE_NAME);
      const all = await this.promisify(store.getAll());
      const now = Date.now();
      const deliveredSet = new Set(eventIds);
      for (const entry of all) {
        if (deliveredSet.has(entry.id)) {
          await this.promisify(store.delete(entry.id));
        } else if (entry.status === "delivered") {
          await this.promisify(store.delete(entry.id));
        } else if (entry.expiresAt !== void 0 && entry.expiresAt <= now) {
          await this.promisify(store.delete(entry.id));
        }
      }
    }
    /** Update a single entry's status. */
    async updateStatus(eventId, status) {
      if (this.degraded) {
        const entry2 = this.memoryQueue.find((e) => e.id === eventId);
        if (entry2) {
          entry2.status = status;
        }
        return;
      }
      const tx = this.transaction("readwrite");
      const store = tx.objectStore(STORE_NAME);
      const entry = await this.promisify(store.get(eventId));
      if (entry) {
        entry.status = status;
        await this.promisify(store.put(entry));
      }
    }
    /** Delete all events from the outbox. */
    async clear() {
      if (this.degraded) {
        this.memoryQueue = [];
        return;
      }
      const tx = this.transaction("readwrite");
      const store = tx.objectStore(STORE_NAME);
      await this.promisify(store.clear());
    }
    /** Close the database connection. */
    close() {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
    }
    /** Get the number of entries in the outbox. */
    async count() {
      if (this.degraded) {
        return this.memoryQueue.length;
      }
      const tx = this.transaction("readonly");
      const store = tx.objectStore(STORE_NAME);
      return this.promisify(store.count());
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    openDatabase() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
            store.createIndex("status", "status", { unique: false });
            store.createIndex("createdAt", "createdAt", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    transaction(mode) {
      if (!this.db) {
        throw new Error("Database is not open");
      }
      return this.db.transaction(STORE_NAME, mode);
    }
    promisify(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    evictMemoryQueue() {
      const deliveredIdx = this.memoryQueue.findIndex((e) => e.status === "delivered");
      if (deliveredIdx >= 0) {
        this.memoryQueue.splice(deliveredIdx, 1);
        return;
      }
      if (this.memoryQueue.length > 0) {
        this.memoryQueue.shift();
      }
    }
    async evictIdb(store) {
      const statusIndex = store.index("status");
      const delivered = await this.promisify(statusIndex.getAll("delivered"));
      if (delivered.length > 0) {
        delivered.sort((a, b) => a.createdAt - b.createdAt);
        const oldest = delivered[0];
        if (oldest) await this.promisify(store.delete(oldest.id));
        return;
      }
      const createdAtIndex = store.index("createdAt");
      const allByAge = await this.promisify(createdAtIndex.getAll(void 0, 1));
      const oldestEntry = allByAge[0];
      if (oldestEntry) {
        await this.promisify(store.delete(oldestEntry.id));
      }
    }
  };

  // ../core/src/types.ts
  var PROTOCOL_VERSION = 1;

  // ../core/src/worker/tabmesh-worker.ts
  var ports = /* @__PURE__ */ new Map();
  var drainScheduled = false;
  var drainRunning = false;
  var channelName = null;
  var outbox = null;
  var outboxReady = null;
  var BATCH_WINDOW_MS = 50;
  var DEFAULT_STALE_TIMEOUT_MS = 3e4;
  var staleTimeoutMs = DEFAULT_STALE_TIMEOUT_MS;
  var transportConfig = null;
  var ws = null;
  var wsConnected = false;
  var reconnectAttempt = 0;
  var reconnectTimer = null;
  var RECONNECT_INITIAL_MS = 1e3;
  var RECONNECT_MAX_MS = 3e4;
  var RECONNECT_MULTIPLIER = 2;
  var sentIds = /* @__PURE__ */ new Map();
  var SENT_ID_TTL_MS = 6e4;
  var SENT_ID_MAX = 1e3;
  var fannedOutIds = /* @__PURE__ */ new Map();
  var FANNED_OUT_TTL_MS = 5 * 6e4;
  var FANNED_OUT_MAX = 5e3;
  function rememberFannedOut(id) {
    if (!id) return;
    fannedOutIds.set(id, Date.now() + FANNED_OUT_TTL_MS);
    if (fannedOutIds.size > FANNED_OUT_MAX) {
      const now = Date.now();
      for (const [k, exp] of fannedOutIds) {
        if (exp < now) fannedOutIds.delete(k);
        if (fannedOutIds.size <= FANNED_OUT_MAX) break;
      }
    }
  }
  function wasFannedOut(id) {
    const exp = fannedOutIds.get(id);
    if (exp == null) return false;
    if (exp < Date.now()) {
      fannedOutIds.delete(id);
      return false;
    }
    return true;
  }
  function rememberSent(id) {
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
  function consumeIfSelf(id) {
    if (!id) return false;
    const exp = sentIds.get(id);
    if (exp == null) return false;
    sentIds.delete(id);
    return exp >= Date.now();
  }
  self.onconnect = (connectEvent) => {
    const port = connectEvent.ports[0];
    if (!port) return;
    port.onmessage = (event) => {
      handleMessage(port, event.data);
    };
    port.start();
  };
  function handleMessage(port, msg) {
    switch (msg.kind) {
      case "handshake":
        handleHandshake(port, msg);
        break;
      case "outbox-write":
        void handleOutboxWrite(port, msg);
        break;
      case "outbox-flush":
        scheduleDrain();
        break;
      case "clear-outbox":
        void handleClearOutbox();
        break;
      case "broadcast-event":
        handleBroadcastEvent(port, msg);
        break;
      case "ping":
        handlePing(port, msg);
        break;
      case "lifecycle":
        handleLifecycle(msg);
        break;
      case "transport-config":
        handleTransportConfig(msg.config);
        break;
      case "transport-disconnect":
        closeTransport("explicit");
        break;
    }
  }
  function handleHandshake(port, msg) {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      const response2 = {
        kind: "handshake-ack",
        accepted: false,
        reason: `Protocol version mismatch. Hub: ${PROTOCOL_VERSION}, Tab: ${msg.protocolVersion}. Please reload the page.`
      };
      port.postMessage(response2);
      return;
    }
    if (!channelName) {
      channelName = msg.channelName;
      if (typeof msg.staleTimeoutMs === "number" && msg.staleTimeoutMs > 0) {
        staleTimeoutMs = msg.staleTimeoutMs;
      }
      ensureOutbox();
    }
    ensureStalePortSweeperStarted();
    ports.set(msg.tabId, {
      tabId: msg.tabId,
      port,
      lastSeenAt: Date.now(),
      visibilityState: "visible"
    });
    const response = { kind: "handshake-ack", accepted: true };
    port.postMessage(response);
    if (transportConfig) {
      postSystemEventToPort(port, wsConnected ? "transport.connected" : "transport.disconnected", {});
    }
    scheduleDrain();
  }
  function ensureOutbox() {
    if (outboxReady) return outboxReady;
    if (!channelName) return Promise.resolve();
    outbox = new EventOutbox(channelName);
    outboxReady = outbox.open().then(({ degraded }) => {
      if (degraded) {
        emitSystemEvent("storage.degraded", { reason: "indexeddb_unavailable" });
      }
    });
    return outboxReady;
  }
  async function handleOutboxWrite(port, msg) {
    await ensureOutbox();
    if (!outbox) return;
    await outbox.put(msg.entry);
    const ack = { kind: "outbox-write-ack", eventId: msg.entry.id };
    port.postMessage(ack);
    scheduleDrain();
  }
  function scheduleDrain() {
    if (drainScheduled) return;
    drainScheduled = true;
    setTimeout(() => {
      drainScheduled = false;
      void drain();
    }, BATCH_WINDOW_MS);
  }
  async function drain() {
    if (drainRunning) {
      scheduleDrain();
      return;
    }
    await ensureOutbox();
    if (!outbox) return;
    drainRunning = true;
    try {
      const pending = await outbox.readPending();
      const deliveredIds = [];
      for (const entry of pending) {
        const alreadyFannedOut = wasFannedOut(entry.id);
        const baseEvent = {
          type: entry.type,
          payload: entry.payload,
          source: "local",
          meta: {
            internalSource: "port",
            sourceTabId: entry.sourceTabId,
            eventId: entry.id,
            createdAt: entry.createdAt
          }
        };
        if (!alreadyFannedOut) {
          for (const [tabId, portEntry] of ports) {
            try {
              const tabEvent = {
                ...baseEvent,
                source: tabId === entry.sourceTabId ? "local" : "remote"
              };
              const out = { kind: "event", event: tabEvent };
              portEntry.port.postMessage(out);
            } catch {
            }
          }
          rememberFannedOut(entry.id);
        }
        let transportOk = true;
        if (transportConfig) {
          if (ws && wsConnected) {
            try {
              ws.send(JSON.stringify({ type: entry.type, payload: entry.payload, id: entry.id }));
              rememberSent(entry.id);
            } catch {
              transportOk = false;
              emitSystemEvent("event.delivery.failed", {
                eventId: entry.id,
                reason: "transport_send_failed"
              });
            }
          } else {
            transportOk = false;
          }
        }
        if (transportOk) {
          deliveredIds.push(entry.id);
        }
      }
      await outbox.markDeliveredAndCleanup(deliveredIds);
      for (const id of deliveredIds) fannedOutIds.delete(id);
    } finally {
      drainRunning = false;
    }
  }
  async function handleClearOutbox() {
    await ensureOutbox();
    if (outbox) {
      await outbox.clear();
    }
  }
  function handleBroadcastEvent(_senderPort, msg) {
    const eventMsg = { kind: "event", event: msg.event };
    for (const [, entry] of ports) {
      try {
        entry.port.postMessage(eventMsg);
      } catch {
      }
    }
  }
  function handlePing(port, msg) {
    const entry = ports.get(msg.tabId);
    if (entry) {
      entry.lastSeenAt = Date.now();
    }
    const pong = {
      kind: "pong",
      tabId: msg.tabId,
      visibilityState: entry?.visibilityState
    };
    port.postMessage(pong);
  }
  function handleLifecycle(msg) {
    const entry = ports.get(msg.tabId);
    if (entry) {
      entry.lastSeenAt = Date.now();
      entry.visibilityState = msg.state;
    }
  }
  function handleTransportConfig(config) {
    if (transportConfig) return;
    transportConfig = config;
    openTransport();
  }
  function openTransport() {
    if (!transportConfig) return;
    if (transportConfig.kind !== "websocket") return;
    try {
      ws = new WebSocket(transportConfig.url, transportConfig.protocols);
    } catch (err) {
      emitSystemEvent("transport.error", {
        message: err instanceof Error ? err.message : String(err)
      });
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      wsConnected = true;
      reconnectAttempt = 0;
      emitSystemEvent("transport.connected", {});
      scheduleDrain();
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      onTransportMessage(event.data);
    };
    ws.onerror = () => {
      emitSystemEvent("transport.error", { message: "websocket_error" });
    };
    ws.onclose = () => {
      wsConnected = false;
      ws = null;
      emitSystemEvent("transport.disconnected", {});
      scheduleReconnect();
    };
  }
  function closeTransport(reason) {
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
      }
      ws = null;
    }
    wsConnected = false;
    emitSystemEvent("transport.disconnected", { reason });
  }
  function scheduleReconnect() {
    if (!transportConfig) return;
    if (reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_INITIAL_MS * RECONNECT_MULTIPLIER ** reconnectAttempt,
      RECONNECT_MAX_MS
    );
    reconnectAttempt += 1;
    emitSystemEvent("transport.reconnecting", { attempt: reconnectAttempt, delayMs: delay });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openTransport();
    }, delay);
  }
  function onTransportMessage(data) {
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof parsed?.type !== "string") return;
    if (typeof parsed.id === "string" && consumeIfSelf(parsed.id)) return;
    const event = {
      type: parsed.type,
      payload: parsed.payload,
      source: "remote",
      meta: {
        internalSource: "transport",
        sourceTabId: "",
        eventId: parsed.id ?? "",
        createdAt: Date.now()
      }
    };
    const msg = { kind: "event", event };
    for (const [, portEntry] of ports) {
      try {
        portEntry.port.postMessage(msg);
      } catch {
      }
    }
  }
  function emitSystemEvent(type, payload) {
    const msg = { kind: "system-event", event: buildSystemEvent(type, payload) };
    for (const [, portEntry] of ports) {
      try {
        portEntry.port.postMessage(msg);
      } catch {
      }
    }
  }
  function postSystemEventToPort(port, type, payload) {
    const msg = { kind: "system-event", event: buildSystemEvent(type, payload) };
    try {
      port.postMessage(msg);
    } catch {
    }
  }
  function buildSystemEvent(type, payload) {
    return {
      type,
      payload,
      source: "local",
      meta: {
        internalSource: "port",
        sourceTabId: "",
        eventId: "",
        createdAt: Date.now()
      }
    };
  }
  var STALE_CHECK_FLOOR_MS = 100;
  var STALE_CHECK_CEILING_MS = 15e3;
  var stalePortSweeperStarted = false;
  function ensureStalePortSweeperStarted() {
    if (stalePortSweeperStarted) return;
    stalePortSweeperStarted = true;
    const intervalMs = Math.min(
      Math.max(Math.floor(staleTimeoutMs / 4), STALE_CHECK_FLOOR_MS),
      STALE_CHECK_CEILING_MS
    );
    setInterval(() => {
      const now = Date.now();
      for (const [tabId, entry] of ports) {
        if (now - entry.lastSeenAt > staleTimeoutMs) {
          ports.delete(tabId);
          try {
            entry.port.close();
          } catch {
          }
        }
      }
    }, intervalMs);
  }
})();
