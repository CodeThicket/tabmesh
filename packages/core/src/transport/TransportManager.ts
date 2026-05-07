/**
 * Transport Manager — owns reconnection logic for the pluggable Transport.
 *
 * When a Transport disconnects, the TransportManager runs retry logic
 * (configurable maxAttempts, backoff) and calls `connect()` again.
 * All Transport adapters get consistent reconnection behavior for free.
 */

import type { ReconnectConfig, TabMeshEvent, Transport } from '../types.js';

/** Default reconnection configuration. */
const RECONNECT_DEFAULTS: ReconnectConfig = {
  maxAttempts: 10,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30_000,
};

/** Events emitted by the TransportManager. */
export interface TransportManagerCallbacks {
  onMessage: (data: string) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onReconnecting: (attempt: number, maxAttempts: number) => void;
  onError: (error: Error) => void;
  onSystemEvent: (event: TabMeshEvent) => void;
}

/**
 * TransportManager wraps a Transport adapter and handles lifecycle,
 * reconnection with exponential backoff, and event forwarding.
 */
export class TransportManager {
  private readonly transport: Transport;
  private readonly config: ReconnectConfig;
  private readonly callbacks: TransportManagerCallbacks;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private intentionalDisconnect = false;

  constructor(
    transport: Transport,
    callbacks: TransportManagerCallbacks,
    config?: Partial<ReconnectConfig>
  ) {
    this.transport = transport;
    this.callbacks = callbacks;
    this.config = { ...RECONNECT_DEFAULTS, ...config };

    // Wire up transport callbacks
    this.transport.onMessage = (data) => {
      this.callbacks.onMessage(data);
    };

    this.transport.onDisconnect = () => {
      this.connected = false;
      this.callbacks.onDisconnected();
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      }
    };

    this.transport.onError = (error) => {
      this.callbacks.onError(error);
    };
  }

  /** Whether the transport is currently connected. */
  get isConnected(): boolean {
    return this.connected;
  }

  /** Whether a reconnect is currently scheduled. */
  get isReconnecting(): boolean {
    return this.reconnectTimer !== null;
  }

  /** Connect the transport. */
  async connect(): Promise<void> {
    this.intentionalDisconnect = false;
    this.reconnectAttempt = 0;

    try {
      await this.transport.connect();
      this.connected = true;
      this.callbacks.onConnected();
    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
    }
  }

  /** Disconnect the transport intentionally. */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.cancelReconnect();

    if (this.connected) {
      try {
        await this.transport.disconnect();
      } catch {
        // Best effort
      }
      this.connected = false;
    }
  }

  /** Send data through the transport. */
  async send(data: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport is not connected');
    }
    await this.transport.send(data);
  }

  // ---------------------------------------------------------------------------
  // Reconnection
  // ---------------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect) return;
    if (this.reconnectAttempt >= this.config.maxAttempts) {
      // Exhausted retries
      this.emitDeliveryFailed();
      return;
    }

    this.reconnectAttempt++;
    const delay = Math.min(
      this.config.initialDelayMs * this.config.backoffMultiplier ** (this.reconnectAttempt - 1),
      this.config.maxDelayMs
    );

    this.callbacks.onReconnecting(this.reconnectAttempt, this.config.maxAttempts);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.transport.connect();
        this.connected = true;
        this.reconnectAttempt = 0;
        this.callbacks.onConnected();
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
  }

  private emitDeliveryFailed(): void {
    this.callbacks.onSystemEvent({
      type: 'transport.error',
      payload: {
        reason: 'max_retries_exhausted',
        attempts: this.config.maxAttempts,
      },
      source: 'local',
      meta: {
        internalSource: 'transport',
        sourceTabId: '',
        eventId: '',
        createdAt: Date.now(),
      },
    });
  }
}
