import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketTransport } from '../src/WebSocketTransport';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type WSEventHandler = ((...args: unknown[]) => void) | null;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  url: string;
  protocols?: string | string[];
  readyState = MockWebSocket.CONNECTING;

  onopen: WSEventHandler = null;
  onclose: WSEventHandler = null;
  onmessage: WSEventHandler = null;
  onerror: WSEventHandler = null;

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  });

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    // Store for test access
    MockWebSocket._lastInstance = this;
  }

  // Test helpers
  static _lastInstance: MockWebSocket | null = null;

  _simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  _simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }

  _simulateError(message = 'connection failed'): void {
    this.onerror?.({ message });
  }

  _simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocketTransport', () => {
  let originalWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    MockWebSocket._lastInstance = null;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it('connects to the given URL', async () => {
    const transport = new WebSocketTransport({ url: 'wss://example.com/ws' });

    const connectPromise = transport.connect();
    const ws = MockWebSocket._lastInstance;
    expect(ws).not.toBeNull();
    expect(ws?.url).toBe('wss://example.com/ws');

    ws?._simulateOpen();
    await connectPromise;
  });

  it('passes protocols to WebSocket constructor', async () => {
    const transport = new WebSocketTransport({
      url: 'wss://example.com/ws',
      protocols: ['graphql-ws'],
    });

    const connectPromise = transport.connect();
    const ws = MockWebSocket._lastInstance;
    expect(ws?.protocols).toEqual(['graphql-ws']);

    ws?._simulateOpen();
    await connectPromise;
  });

  it('rejects connect() on error during connection', async () => {
    const transport = new WebSocketTransport({ url: 'wss://example.com/ws' });
    const onError = vi.fn();
    transport.onError = onError;

    const connectPromise = transport.connect();
    const ws = MockWebSocket._lastInstance;

    ws?._simulateError('connection refused');
    await expect(connectPromise).rejects.toThrow('WebSocket error');
    expect(onError).toHaveBeenCalled();
  });

  it('sends data through the WebSocket', async () => {
    const transport = new WebSocketTransport({ url: 'wss://example.com/ws' });

    const connectPromise = transport.connect();
    MockWebSocket._lastInstance?._simulateOpen();
    await connectPromise;

    await transport.send('{"type":"test"}');
    expect(MockWebSocket._lastInstance?.send).toHaveBeenCalledWith('{"type":"test"}');
  });

  it('throws when sending on disconnected transport', async () => {
    const transport = new WebSocketTransport({ url: 'wss://example.com/ws' });

    await expect(transport.send('data')).rejects.toThrow('WebSocket is not connected');
  });

  it('calls onMessage when receiving data', async () => {
    const transport = new WebSocketTransport({ url: 'wss://example.com/ws' });
    const onMessage = vi.fn();
    transport.onMessage = onMessage;

    const connectPromise = transport.connect();
    const ws = MockWebSocket._lastInstance;
    ws?._simulateOpen();
    await connectPromise;

    ws?._simulateMessage('{"event":"hello"}');
    expect(onMessage).toHaveBeenCalledWith('{"event":"hello"}');
  });

  it('calls onDisconnect when connection closes unexpectedly', async () => {
    const transport = new WebSocketTransport({ url: 'wss://example.com/ws' });
    const onDisconnect = vi.fn();
    transport.onDisconnect = onDisconnect;

    const connectPromise = transport.connect();
    const ws = MockWebSocket._lastInstance;
    ws?._simulateOpen();
    await connectPromise;

    ws?._simulateClose();
    expect(onDisconnect).toHaveBeenCalled();
  });

  it('does NOT call onDisconnect on intentional disconnect', async () => {
    const transport = new WebSocketTransport({ url: 'wss://example.com/ws' });
    const onDisconnect = vi.fn();
    transport.onDisconnect = onDisconnect;

    const connectPromise = transport.connect();
    const ws = MockWebSocket._lastInstance;
    ws?._simulateOpen();
    await connectPromise;

    await transport.disconnect();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it('disconnect is safe to call when not connected', async () => {
    const transport = new WebSocketTransport({ url: 'wss://example.com/ws' });
    // Should not throw
    await transport.disconnect();
  });

  it('calls onError for errors after connection is open', async () => {
    const transport = new WebSocketTransport({ url: 'wss://example.com/ws' });
    const onError = vi.fn();
    transport.onError = onError;

    const connectPromise = transport.connect();
    const ws = MockWebSocket._lastInstance;
    ws?._simulateOpen();
    await connectPromise;

    // Simulate error after connection is established
    ws!.readyState = MockWebSocket.OPEN;
    ws?._simulateError('unexpected error');
    expect(onError).toHaveBeenCalled();
  });

  it('exposes a serialisable worker config for SharedWorker mode', () => {
    const transport = new WebSocketTransport({
      url: 'wss://example.com/ws',
      protocols: ['proto-1'],
    });
    expect(transport.getWorkerConfig()).toEqual({
      kind: 'websocket',
      url: 'wss://example.com/ws',
      protocols: ['proto-1'],
    });
  });
});
