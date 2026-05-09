import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportManager } from '../src/transport/TransportManager';
import type { Transport } from '../src/types';

function createMockTransport(): Transport & {
  _triggerMessage: (data: string) => void;
  _triggerDisconnect: () => void;
  _triggerError: (err: Error) => void;
  connectCalls: number;
  sendCalls: string[];
} {
  const transport = {
    connectCalls: 0,
    sendCalls: [] as string[],
    onMessage: null as ((data: string) => void) | null,
    onDisconnect: null as (() => void) | null,
    onError: null as ((error: Error) => void) | null,

    async connect() {
      transport.connectCalls++;
    },
    async disconnect() {},
    async send(data: string) {
      transport.sendCalls.push(data);
    },
    _triggerMessage(data: string) {
      transport.onMessage?.(data);
    },
    _triggerDisconnect() {
      transport.onDisconnect?.();
    },
    _triggerError(err: Error) {
      transport.onError?.(err);
    },
  };
  return transport;
}

describe('TransportManager', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let callbacks: {
    onMessage: ReturnType<typeof vi.fn>;
    onConnected: ReturnType<typeof vi.fn>;
    onDisconnected: ReturnType<typeof vi.fn>;
    onReconnecting: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
    onSystemEvent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    transport = createMockTransport();
    callbacks = {
      onMessage: vi.fn(),
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onReconnecting: vi.fn(),
      onError: vi.fn(),
      onSystemEvent: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should connect and fire onConnected', async () => {
    const manager = new TransportManager(transport, callbacks);
    await manager.connect();
    expect(manager.isConnected).toBe(true);
    expect(callbacks.onConnected).toHaveBeenCalledOnce();
  });

  it('should forward messages from transport', async () => {
    const manager = new TransportManager(transport, callbacks);
    await manager.connect();

    transport._triggerMessage('{"type":"test"}');
    expect(callbacks.onMessage).toHaveBeenCalledWith('{"type":"test"}');
  });

  it('should forward errors from transport', async () => {
    const manager = new TransportManager(transport, callbacks);
    await manager.connect();

    const err = new Error('connection lost');
    transport._triggerError(err);
    expect(callbacks.onError).toHaveBeenCalledWith(err);
  });

  it('should send data through connected transport', async () => {
    const manager = new TransportManager(transport, callbacks);
    await manager.connect();

    await manager.send('hello');
    expect(transport.sendCalls).toEqual(['hello']);
  });

  it('should throw when sending on disconnected transport', async () => {
    const manager = new TransportManager(transport, callbacks);
    await expect(manager.send('hello')).rejects.toThrow('Transport is not connected');
  });

  it('should disconnect intentionally', async () => {
    const manager = new TransportManager(transport, callbacks);
    await manager.connect();
    await manager.disconnect();

    expect(manager.isConnected).toBe(false);
  });

  it('should reconnect on unintentional disconnect', async () => {
    const manager = new TransportManager(transport, callbacks, {
      initialDelayMs: 100,
      maxAttempts: 3,
      backoffMultiplier: 1,
      maxDelayMs: 1000,
    });
    await manager.connect();
    expect(transport.connectCalls).toBe(1);

    // Simulate unintentional disconnect
    transport._triggerDisconnect();
    expect(callbacks.onDisconnected).toHaveBeenCalled();
    expect(callbacks.onReconnecting).toHaveBeenCalledWith(1, 3);

    // Advance timer to trigger reconnect
    await vi.advanceTimersByTimeAsync(100);
    expect(transport.connectCalls).toBe(2);
    expect(callbacks.onConnected).toHaveBeenCalledTimes(2);
  });

  it('should not reconnect on intentional disconnect', async () => {
    const manager = new TransportManager(transport, callbacks);
    await manager.connect();
    await manager.disconnect();

    expect(callbacks.onReconnecting).not.toHaveBeenCalled();
    expect(manager.isReconnecting).toBe(false);
  });

  it('should emit system event after max retries exhausted', async () => {
    // Create a transport that always fails to connect
    let firstConnect = true;
    const failTransport: Transport = {
      onMessage: null,
      onDisconnect: null,
      onError: null,
      async connect() {
        if (firstConnect) {
          firstConnect = false;
          return; // First connect succeeds
        }
        throw new Error('connect failed');
      },
      async disconnect() {},
      async send() {},
    };

    const manager = new TransportManager(failTransport, callbacks, {
      initialDelayMs: 10,
      maxAttempts: 2,
      backoffMultiplier: 1,
      maxDelayMs: 100,
    });

    await manager.connect();

    // Trigger disconnect
    failTransport.onDisconnect?.();

    // First retry
    await vi.advanceTimersByTimeAsync(10);
    // Second retry
    await vi.advanceTimersByTimeAsync(10);

    // After max retries, system event should be emitted
    expect(callbacks.onSystemEvent).toHaveBeenCalled();
  });
});
