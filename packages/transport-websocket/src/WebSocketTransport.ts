/**
 * WebSocket transport adapter.
 *
 * Implements the Transport interface from @tabmesh/core.
 * Transports are dumb pipes — they handle raw strings, not structured events.
 * Reconnection is owned by the Hub / TransportManager, not the Transport.
 */

import type { Transport, WorkerTransportConfig } from '@tabmesh/core';

/** Configuration for the WebSocket transport. */
export interface WebSocketTransportConfig {
  /** WebSocket URL (e.g., 'wss://api.example.com/events'). */
  url: string;
  /** Protocols to pass to the WebSocket constructor. */
  protocols?: string | string[];
}

/**
 * WebSocket transport adapter for TabMesh.
 *
 * @example
 * ```typescript
 * const transport = new WebSocketTransport({
 *   url: 'wss://api.example.com/events',
 * });
 * ```
 */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private readonly config: WebSocketTransportConfig;

  onMessage: ((data: string) => void) | null = null;
  onDisconnect: (() => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  constructor(config: WebSocketTransportConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url, this.config.protocols);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.ws.onopen = () => {
        resolve();
      };

      this.ws.onerror = (event) => {
        const error = new Error(`WebSocket error: ${(event as ErrorEvent).message ?? 'unknown'}`);
        this.onError?.(error);
        // Reject only if we're still connecting
        if (this.ws?.readyState === WebSocket.CONNECTING) {
          reject(error);
        }
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          this.onMessage?.(event.data);
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.onDisconnect?.();
      };
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      // Remove onclose to prevent the onDisconnect callback during intentional close
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  async send(data: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(data);
  }

  getWorkerConfig(): WorkerTransportConfig {
    return {
      kind: 'websocket',
      url: this.config.url,
      protocols: this.config.protocols,
    };
  }
}
