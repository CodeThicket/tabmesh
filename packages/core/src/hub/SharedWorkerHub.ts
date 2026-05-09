/**
 * SharedWorker Hub — Primary mode.
 *
 * A single SharedWorker instance shared across all tabs of the same origin.
 * Holds the Transport connection, drains the Outbox, and relays events
 * between tabs via MessagePort.
 *
 * Eliminates leader election, split-brain, and interregnum by design.
 */

import type {
  Hub,
  HubMessage,
  OutboxEntry,
  TabMeshEvent,
  Transport,
  WorkerTransportConfig,
} from '../types.js';
import { PROTOCOL_VERSION } from '../types.js';

/**
 * SharedWorkerHub connects a tab to a SharedWorker that acts as the hub.
 * The SharedWorker script is loaded from a stable URL.
 */
export class SharedWorkerHub implements Hub {
  private worker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private eventHandler: ((event: TabMeshEvent) => void) | null = null;
  private systemEventHandler: ((event: TabMeshEvent) => void) | null = null;
  private _connected = false;
  private readonly channelName: string;
  private readonly workerUrl: string;
  private readonly workerTransportConfig: WorkerTransportConfig | null;
  private tabId: string | null = null;

  // Pending submit promises awaiting outbox-write-ack
  private pendingSubmits = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();

  constructor(channelName: string, workerUrl?: string, transport?: Transport) {
    this.channelName = channelName;
    this.workerUrl = workerUrl ?? '/tabmesh-worker.js';
    this.workerTransportConfig = transport?.getWorkerConfig?.() ?? null;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(tabId: string): Promise<void> {
    this.tabId = tabId;

    // Create SharedWorker with namespaced name
    this.worker = new SharedWorker(this.workerUrl, {
      name: `tabmesh:${this.channelName}`,
    });

    this.port = this.worker.port;
    this.port.onmessage = (event: MessageEvent<HubMessage>) => {
      this.handleMessage(event.data);
    };
    this.port.start();

    // Perform handshake
    await this.handshake(tabId);

    // Hand the worker our transport descriptor so it can own the connection.
    // The worker ignores duplicate configs from later tabs.
    if (this.workerTransportConfig && this.port) {
      this.port.postMessage({
        kind: 'transport-config',
        config: this.workerTransportConfig,
      } satisfies HubMessage);
    }
  }

  async disconnect(): Promise<void> {
    const wasConnected = this._connected;
    this._connected = false;
    if (this.port) {
      this.port.close();
      this.port = null;
    }
    this.worker = null;

    // Reject pending submits
    for (const [, pending] of this.pendingSubmits) {
      pending.reject(new Error('Hub disconnected'));
    }
    this.pendingSubmits.clear();

    // Mirror ElectedLeaderHub: surface the lifecycle change as a system event
    // so apps and the TabMesh status table see a consistent transition.
    if (wasConnected) {
      this.systemEventHandler?.({
        type: 'hub.disconnected',
        payload: { tabId: this.tabId ?? '' },
        source: 'local',
        meta: {
          internalSource: 'port',
          sourceTabId: this.tabId ?? '',
          eventId: '',
          createdAt: Date.now(),
        },
      });
    }
  }

  async submit(entry: OutboxEntry): Promise<void> {
    const port = this.port;
    if (!port || !this._connected) {
      throw new Error('Not connected to hub');
    }

    return new Promise<void>((resolve, reject) => {
      this.pendingSubmits.set(entry.id, { resolve, reject });
      port.postMessage({
        kind: 'outbox-write',
        entry,
      } satisfies HubMessage);

      // Timeout after 5s
      setTimeout(() => {
        if (this.pendingSubmits.has(entry.id)) {
          this.pendingSubmits.delete(entry.id);
          reject(new Error('Outbox write timed out'));
        }
      }, 5000);
    });
  }

  async clearOutbox(): Promise<void> {
    const port = this.port;
    if (!port || !this._connected) return;

    return new Promise<void>((resolve) => {
      // We fire-and-forget since outbox clearing is best-effort
      port.postMessage({ kind: 'clear-outbox' } satisfies HubMessage);
      resolve();
    });
  }

  broadcastToTabs(event: TabMeshEvent): void {
    if (this.port && this._connected) {
      this.port.postMessage({
        kind: 'broadcast-event',
        event,
      } satisfies HubMessage);
    }
  }

  onEvent(handler: (event: TabMeshEvent) => void): void {
    this.eventHandler = handler;
  }

  onSystemEvent(handler: (event: TabMeshEvent) => void): void {
    this.systemEventHandler = handler;
  }

  async disconnectTransport(): Promise<void> {
    if (this.port && this._connected) {
      this.port.postMessage({ kind: 'transport-disconnect' } satisfies HubMessage);
    }
  }

  async flush(timeoutMs: number): Promise<void> {
    // Ask the worker to drain immediately and wait up to timeoutMs. The
    // worker is fire-and-forget for outbox-flush, so we just nudge it and
    // sleep — there is no per-tab ack for "drain complete."
    if (!this.port || !this._connected) return;
    this.port.postMessage({ kind: 'outbox-flush' } satisfies HubMessage);
    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  }

  /** Send a lifecycle update to the hub. */
  sendLifecycle(state: 'visible' | 'hidden' | 'frozen'): void {
    if (this.port && this._connected && this.tabId) {
      this.port.postMessage({
        kind: 'lifecycle',
        tabId: this.tabId,
        state,
      } satisfies HubMessage);
    }
  }

  /** Send a ping to the hub. */
  sendPing(): void {
    if (this.port && this._connected && this.tabId) {
      this.port.postMessage({
        kind: 'ping',
        tabId: this.tabId,
      } satisfies HubMessage);
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private handshake(tabId: string): Promise<void> {
    const port = this.port;
    if (!port) {
      return Promise.reject(new Error('Port is not available'));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timed out'));
      }, 5000);

      // Temporarily replace handler to catch handshake-ack
      const originalHandler = port.onmessage;
      port.onmessage = (event: MessageEvent<HubMessage>) => {
        const msg = event.data;
        if (msg.kind === 'handshake-ack') {
          clearTimeout(timeout);
          port.onmessage = originalHandler;

          if (msg.accepted) {
            this._connected = true;
            resolve();
          } else {
            reject(new Error(`Handshake rejected: ${msg.reason ?? 'unknown'}`));
          }
          return;
        }
        // Forward other messages normally
        if (originalHandler) {
          originalHandler.call(port, event);
        }
      };

      port.postMessage({
        kind: 'handshake',
        tabId,
        protocolVersion: PROTOCOL_VERSION,
        channelName: this.channelName,
      } satisfies HubMessage);
    });
  }

  private handleMessage(msg: HubMessage): void {
    switch (msg.kind) {
      case 'event':
        this.eventHandler?.(msg.event);
        break;
      case 'system-event':
        this.systemEventHandler?.(msg.event);
        break;
      case 'outbox-write-ack': {
        const pending = this.pendingSubmits.get(msg.eventId);
        if (pending) {
          this.pendingSubmits.delete(msg.eventId);
          pending.resolve();
        }
        break;
      }
      case 'pong':
        // Hub is alive — no action needed
        break;
    }
  }
}
