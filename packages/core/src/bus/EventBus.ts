/**
 * BroadcastChannel wrapper for cross-tab messaging.
 *
 * Provides typed publish/subscribe over BroadcastChannel with
 * automatic cleanup and error handling.
 */

import type { HubMessage } from '../types.js';

/**
 * EventBus wraps BroadcastChannel for cross-tab communication.
 * Used internally by the Hub implementations and available as a
 * standalone tree-shakeable export for simple cross-tab messaging.
 */
export class EventBus {
  private channel: BroadcastChannel | null = null;
  private handlers = new Map<string, Set<(msg: HubMessage) => void>>();
  private wildcardHandlers = new Set<(msg: HubMessage) => void>();
  private closed = false;

  constructor(private readonly channelName: string) {}

  /** Open the BroadcastChannel and start listening. */
  open(): void {
    if (this.closed) {
      throw new Error('EventBus has been closed');
    }
    if (this.channel) {
      return; // already open
    }

    this.channel = new BroadcastChannel(`tabmesh:${this.channelName}`);
    this.channel.onmessage = (event: MessageEvent<HubMessage>) => {
      this.dispatch(event.data);
    };
    this.channel.onmessageerror = () => {
      // Deserialization failed - ignore malformed messages
    };
  }

  /**
   * Broadcast a message to all other tabs on this channel.
   * Does NOT deliver to handlers in the current tab.
   */
  broadcast(message: HubMessage): void {
    if (!this.channel) {
      throw new Error('EventBus is not open. Call open() first.');
    }
    this.channel.postMessage(message);
  }

  /**
   * Broadcast a message and also dispatch it to local handlers.
   * Useful when the current tab needs to receive its own messages.
   */
  broadcastAndDispatchLocally(message: HubMessage): void {
    this.broadcast(message);
    this.dispatch(message);
  }

  /**
   * Subscribe to messages of a specific kind.
   * @returns Unsubscribe function.
   */
  on(kind: HubMessage['kind'], handler: (msg: HubMessage) => void): () => void {
    let set = this.handlers.get(kind);
    if (!set) {
      set = new Set();
      this.handlers.set(kind, set);
    }
    const captured = set;
    captured.add(handler);
    return () => {
      captured.delete(handler);
    };
  }

  /**
   * Subscribe to all messages regardless of kind.
   * @returns Unsubscribe function.
   */
  onAny(handler: (msg: HubMessage) => void): () => void {
    this.wildcardHandlers.add(handler);
    return () => {
      this.wildcardHandlers.delete(handler);
    };
  }

  /** Close the BroadcastChannel and remove all handlers. */
  close(): void {
    this.closed = true;
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.handlers.clear();
    this.wildcardHandlers.clear();
  }

  /** Whether the bus is currently open. */
  get isOpen(): boolean {
    return this.channel !== null && !this.closed;
  }

  /** Dispatch a message to registered handlers. */
  private dispatch(message: HubMessage): void {
    const kindHandlers = this.handlers.get(message.kind);
    if (kindHandlers) {
      for (const handler of kindHandlers) {
        try {
          handler(message);
        } catch {
          // Don't let one handler break others
        }
      }
    }
    for (const handler of this.wildcardHandlers) {
      try {
        handler(message);
      } catch {
        // Don't let one handler break others
      }
    }
  }
}
