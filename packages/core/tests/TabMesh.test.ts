import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabMesh } from '../src/TabMesh';
import { TabMeshError } from '../src/errors';
import type { Hub, OutboxEntry, TabMeshEvent } from '../src/types';

// Mock hub for testing
function createMockHub(): Hub & {
  _eventHandler: ((event: TabMeshEvent) => void) | null;
  _systemEventHandler: ((event: TabMeshEvent) => void) | null;
  _submitted: OutboxEntry[];
  _broadcasted: TabMeshEvent[];
  _outboxCleared: boolean;
  _connected: boolean;
  _emitEvent: (event: TabMeshEvent) => void;
  _emitSystemEvent: (event: TabMeshEvent) => void;
} {
  const hub = {
    _eventHandler: null as ((event: TabMeshEvent) => void) | null,
    _systemEventHandler: null as ((event: TabMeshEvent) => void) | null,
    _submitted: [] as OutboxEntry[],
    _broadcasted: [] as TabMeshEvent[],
    _outboxCleared: false,
    _connected: false,

    get connected() {
      return hub._connected;
    },

    async connect(_tabId: string) {
      hub._connected = true;
    },

    async disconnect() {
      hub._connected = false;
    },

    async submit(entry: OutboxEntry) {
      hub._submitted.push(entry);
    },

    async clearOutbox() {
      hub._outboxCleared = true;
    },

    broadcastToTabs(event: TabMeshEvent) {
      hub._broadcasted.push(event);
    },

    onEvent(handler: (event: TabMeshEvent) => void) {
      hub._eventHandler = handler;
    },

    onSystemEvent(handler: (event: TabMeshEvent) => void) {
      hub._systemEventHandler = handler;
    },

    _emitEvent(event: TabMeshEvent) {
      hub._eventHandler?.(event);
    },

    _emitSystemEvent(event: TabMeshEvent) {
      hub._systemEventHandler?.(event);
    },
  };
  return hub;
}

// We need to mock the hub creation inside TabMesh
// Since we can't easily mock SharedWorker, we'll test with a mock
describe('TabMesh', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create with channelName', () => {
    const mesh = new TabMesh({ channelName: 'test-app' });
    const status = mesh.getStatus();
    expect(status.started).toBe(false);
    expect(status.tabId).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should throw ALREADY_STOPPED when starting a stopped instance', async () => {
    const mesh = new TabMesh({ channelName: 'test' });

    // We need to mock createHub to avoid SharedWorker
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();
    await mesh.stop();

    await expect(mesh.start()).rejects.toThrow(TabMeshError);
    try {
      await mesh.start();
    } catch (err) {
      expect((err as TabMeshError).code).toBe('ALREADY_STOPPED');
    }
  });

  it('should throw ALREADY_STARTED when starting twice', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();

    await expect(mesh.start()).rejects.toThrow(TabMeshError);
    try {
      await mesh.start();
    } catch (err) {
      expect((err as TabMeshError).code).toBe('ALREADY_STARTED');
    }

    await mesh.stop();
  });

  it('should throw ALREADY_STOPPED when sending on stopped instance', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();
    await mesh.stop();

    await expect(mesh.send({ type: 'test', payload: 'data' })).rejects.toThrow(TabMeshError);
  });

  it('should buffer events sent before start()', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    // Send before start — should not throw
    await mesh.send({ type: 'pre-start', payload: 'buffered' });

    await mesh.start();

    // The buffered event should have been submitted
    expect(mockHub._submitted).toHaveLength(1);
    expect(mockHub._submitted[0]?.type).toBe('pre-start');

    await mesh.stop();
  });

  it('should send events through the hub after start', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();
    await mesh.send({ type: 'chat.message', payload: { text: 'Hi' } });

    expect(mockHub._submitted).toHaveLength(1);
    expect(mockHub._submitted[0]?.type).toBe('chat.message');
    expect(mockHub._submitted[0]?.payload).toEqual({ text: 'Hi' });
    expect(mockHub._submitted[0]?.status).toBe('pending');

    await mesh.stop();
  });

  it('should send events with priority and TTL', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();
    await mesh.send({
      type: 'urgent',
      payload: {},
      priority: 10,
      ttl: 60_000,
    });

    const entry = mockHub._submitted[0]!;
    expect(entry.priority).toBe(10);
    expect(entry.expiresAt).toBeDefined();
    expect(entry.expiresAt! - entry.createdAt).toBeCloseTo(60_000, -2);

    await mesh.stop();
  });

  it('should dispatch events to type-specific handlers', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();

    const received: TabMeshEvent[] = [];
    mesh.on('chat.message', (event) => {
      received.push(event);
    });

    const event: TabMeshEvent = {
      type: 'chat.message',
      payload: { text: 'Hello' },
      source: 'remote',
      meta: {
        internalSource: 'broadcast',
        sourceTabId: 'other-tab',
        eventId: 'other-tab-1',
        createdAt: Date.now(),
      },
    };
    mockHub._emitEvent(event);

    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toEqual({ text: 'Hello' });

    await mesh.stop();
  });

  it('should support wildcard handler with *', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();

    const received: TabMeshEvent[] = [];
    mesh.on('*', (event) => {
      received.push(event);
    });

    mockHub._emitEvent({
      type: 'chat.message',
      payload: {},
      source: 'remote',
      meta: { internalSource: 'broadcast', sourceTabId: '', eventId: '', createdAt: Date.now() },
    });

    mockHub._emitEvent({
      type: 'user.joined',
      payload: {},
      source: 'remote',
      meta: { internalSource: 'broadcast', sourceTabId: '', eventId: '', createdAt: Date.now() },
    });

    expect(received).toHaveLength(2);

    await mesh.stop();
  });

  it('should support unsubscribing handlers', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();

    const received: TabMeshEvent[] = [];
    const unsub = mesh.on('test', (event) => {
      received.push(event);
    });

    const event: TabMeshEvent = {
      type: 'test',
      payload: {},
      source: 'remote',
      meta: { internalSource: 'broadcast', sourceTabId: '', eventId: '', createdAt: Date.now() },
    };

    mockHub._emitEvent(event);
    expect(received).toHaveLength(1);

    unsub();
    mockHub._emitEvent(event);
    expect(received).toHaveLength(1); // No new events

    await mesh.stop();
  });

  it('should not crash if an event handler throws', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();

    const received: TabMeshEvent[] = [];
    mesh.on('test', () => {
      throw new Error('handler error');
    });
    mesh.on('test', (event) => {
      received.push(event);
    });

    mockHub._emitEvent({
      type: 'test',
      payload: {},
      source: 'remote',
      meta: { internalSource: 'broadcast', sourceTabId: '', eventId: '', createdAt: Date.now() },
    });

    // Second handler should still be called
    expect(received).toHaveLength(1);

    await mesh.stop();
  });

  it('should update status on system events', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();
    expect(mesh.getStatus().transportState).toBe('disconnected');

    mockHub._emitSystemEvent({
      type: 'transport.connected',
      payload: {},
      source: 'local',
      meta: { internalSource: 'transport', sourceTabId: '', eventId: '', createdAt: Date.now() },
    });
    expect(mesh.getStatus().transportState).toBe('connected');

    mockHub._emitSystemEvent({
      type: 'transport.reconnecting',
      payload: {},
      source: 'local',
      meta: { internalSource: 'transport', sourceTabId: '', eventId: '', createdAt: Date.now() },
    });
    expect(mesh.getStatus().transportState).toBe('reconnecting');

    mockHub._emitSystemEvent({
      type: 'storage.degraded',
      payload: {},
      source: 'local',
      meta: { internalSource: 'broadcast', sourceTabId: '', eventId: '', createdAt: Date.now() },
    });
    expect(mesh.getStatus().degraded).toBe(true);

    await mesh.stop();
  });

  it('should generate monotonic event IDs for sent events', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();

    await mesh.send({ type: 'a', payload: null });
    await mesh.send({ type: 'b', payload: null });
    await mesh.send({ type: 'c', payload: null });

    const ids = mockHub._submitted.map((e) => e.id);
    expect(ids).toHaveLength(3);

    // All IDs should have the same tab prefix
    const prefix = ids[0]?.split('-')[0];
    for (const id of ids) {
      expect(id?.startsWith(`${prefix}-`)).toBe(true);
    }

    // Counters should be monotonically increasing
    const counters = ids.map((id) => Number.parseInt(id?.split('-')[1]!, 10));
    expect(counters[1]! > counters[0]!).toBe(true);
    expect(counters[2]! > counters[1]!).toBe(true);

    await mesh.stop();
  });

  it('should return correct status', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    let status = mesh.getStatus();
    expect(status.started).toBe(false);
    expect(status.hubConnected).toBe(false);

    await mesh.start();

    status = mesh.getStatus();
    expect(status.started).toBe(true);
    expect(status.hubConnected).toBe(true);
    expect(status.tabId).toMatch(/^[0-9a-f]{8}$/);

    await mesh.stop();

    status = mesh.getStatus();
    expect(status.started).toBe(false);
  });

  it('stop should be idempotent', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();
    await mesh.stop();
    await mesh.stop(); // Should not throw
  });

  it('clearOutbox should delegate to hub', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();
    await mesh.clearOutbox();

    expect(mockHub._outboxCleared).toBe(true);

    await mesh.stop();
  });

  it('broadcast should dispatch locally and broadcast to tabs', async () => {
    const mesh = new TabMesh({ channelName: 'test' });
    const mockHub = createMockHub();
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);

    await mesh.start();

    const received: TabMeshEvent[] = [];
    mesh.on('auth.logout', (event) => {
      received.push(event);
    });

    mesh.broadcast({ type: 'auth.logout', payload: null });

    // Should be dispatched locally
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('auth.logout');
    expect(received[0]?.source).toBe('local');

    // Should be sent to other tabs via hub
    expect(mockHub._broadcasted).toHaveLength(1);
    expect(mockHub._broadcasted[0]?.type).toBe('auth.logout');

    await mesh.stop();
  });

  it('exposes setSession / getSession for the documented logout flow', () => {
    const mesh = new TabMesh({ channelName: 't:session' });
    expect(mesh.getSession()).toEqual({});
    mesh.setSession({ userId: 'u1', tenantId: 't1', sessionId: 's1' });
    expect(mesh.getSession()).toEqual({ userId: 'u1', tenantId: 't1', sessionId: 's1' });
  });

  it('logs a console warning and degrades when storage.degraded fires', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockHub = createMockHub();
    const mesh = new TabMesh({ channelName: 't:degraded' });
    // Wire the hub's system-event channel into TabMesh manually since we
    // bypass start() in this test (no real SharedWorker available).
    mockHub.onSystemEvent((event) =>
      (mesh as unknown as { handleSystemEvent: (e: TabMeshEvent) => void }).handleSystemEvent(event)
    );
    (mesh as unknown as { hub: Hub }).hub = mockHub;
    (mesh as unknown as { started: boolean }).started = true;

    mockHub._emitSystemEvent({
      type: 'storage.degraded',
      payload: { reason: 'indexeddb_unavailable' },
      source: 'local',
      meta: { internalSource: 'broadcast', sourceTabId: '', eventId: '', createdAt: 0 },
    });

    expect(mesh.getStatus().degraded).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('storage.degraded'));
  });

  it('stop() asks the hub to flush before disconnect', async () => {
    const mockHub = createMockHub();
    let flushed = false;
    (mockHub as unknown as { flush: (ms: number) => Promise<void> }).flush = async () => {
      flushed = true;
    };
    const mesh = new TabMesh({ channelName: 't:stop-flush' });
    (mesh as unknown as { hub: Hub }).hub = mockHub;
    (mesh as unknown as { started: boolean }).started = true;
    (mockHub as unknown as { _connected: boolean })._connected = true;

    await mesh.stop();
    expect(flushed).toBe(true);
  });

  it('disconnectTransport delegates to hub.disconnectTransport when available', async () => {
    const mockHub = createMockHub();
    let transportClosed = false;
    (mockHub as unknown as { disconnectTransport: () => Promise<void> }).disconnectTransport =
      async () => {
        transportClosed = true;
      };
    const mesh = new TabMesh({ channelName: 't:disconnect' });
    (mesh as unknown as { hub: Hub }).hub = mockHub;
    (mesh as unknown as { started: boolean }).started = true;

    await mesh.disconnectTransport();
    expect(transportClosed).toBe(true);
    expect(mesh.getStatus().transportState).toBe('disconnected');
  });

  it('logout sequence runs clearOutbox → disconnectTransport → broadcast → stop', async () => {
    const mockHub = createMockHub();
    const order: string[] = [];
    const realClear = mockHub.clearOutbox.bind(mockHub);
    mockHub.clearOutbox = async () => {
      order.push('clear');
      await realClear();
    };
    (mockHub as unknown as { disconnectTransport: () => Promise<void> }).disconnectTransport =
      async () => {
        order.push('disconnectTransport');
      };
    (mockHub as unknown as { flush: (ms: number) => Promise<void> }).flush = async () => {
      order.push('flush');
    };
    const realDisconnect = mockHub.disconnect.bind(mockHub);
    mockHub.disconnect = async () => {
      order.push('disconnect');
      await realDisconnect();
    };
    const realBroadcast = mockHub.broadcastToTabs.bind(mockHub);
    mockHub.broadcastToTabs = (event) => {
      order.push(`broadcast:${event.type}`);
      realBroadcast(event);
    };

    const mesh = new TabMesh({ channelName: 't:logout' });
    vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(mockHub);
    await mesh.start();

    await mesh.clearOutbox();
    await mesh.disconnectTransport();
    mesh.broadcast({ type: 'auth.logout', payload: {} });
    await mesh.stop();

    expect(order).toEqual([
      'clear',
      'disconnectTransport',
      'broadcast:auth.logout',
      'flush',
      'disconnect',
    ]);
  });
});
