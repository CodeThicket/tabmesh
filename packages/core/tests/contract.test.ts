import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabMesh } from '../src/TabMesh';
import { EventOutbox } from '../src/storage/EventOutbox';
import type { Hub, OutboxEntry, TabMeshEvent } from '../src/types';

// Minimal mock hub used by tests that don't care about transport behavior.
function createMockHub(): Hub & {
  _submitted: OutboxEntry[];
  _emitSystem: (event: TabMeshEvent) => void;
} {
  const hub = {
    _submitted: [] as OutboxEntry[],
    _systemHandler: null as ((event: TabMeshEvent) => void) | null,
    _connected: false,
    get connected() {
      return hub._connected;
    },
    async connect() {
      hub._connected = true;
    },
    async disconnect() {
      hub._connected = false;
    },
    async submit(entry: OutboxEntry) {
      hub._submitted.push(entry);
    },
    async clearOutbox() {},
    broadcastToTabs() {},
    onEvent() {},
    onSystemEvent(handler: (event: TabMeshEvent) => void) {
      hub._systemHandler = handler;
    },
    _emitSystem(event: TabMeshEvent) {
      hub._systemHandler?.(event);
    },
  };
  return hub;
}

describe('TabMesh contract', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  describe('transport-less mode (check #19)', () => {
    it('start() resolves without a transport configured', async () => {
      const mesh = new TabMesh({ channelName: 'transportless' });
      const hub = createMockHub();
      vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(hub);

      await mesh.start();
      expect(mesh.getStatus().started).toBe(true);
      // transportState defaults to 'disconnected' until a transport.* event arrives;
      // the Hub doesn't synthesize one when no transport is configured.
      expect(mesh.getStatus().transportState).toBe('disconnected');

      await mesh.send({ type: 'cross-tab', payload: { ok: true } });
      expect(hub._submitted).toHaveLength(1);

      await mesh.stop();
    });
  });

  describe('event.delivery.failed delivery (check #33)', () => {
    it('reaches wildcard subscribers via the system event channel', async () => {
      const mesh = new TabMesh({ channelName: 'delivery-failed' });
      const hub = createMockHub();
      vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(hub);

      const captured: TabMeshEvent[] = [];
      mesh.on('*', (event) => captured.push(event));

      await mesh.start();
      hub._emitSystem({
        type: 'event.delivery.failed',
        payload: { eventId: 'abc', reason: 'transport_send_failed' },
        source: 'local',
        meta: {
          internalSource: 'port',
          sourceTabId: '',
          eventId: '',
          createdAt: Date.now(),
        },
      });

      const failures = captured.filter((e) => e.type === 'event.delivery.failed');
      expect(failures).toHaveLength(1);
      expect(failures[0]?.payload).toMatchObject({
        eventId: 'abc',
        reason: 'transport_send_failed',
      });

      await mesh.stop();
    });
  });

  describe('channel name scoping (check #35)', () => {
    it('different channelNames write to distinct IndexedDB databases', async () => {
      const a = new EventOutbox('app-a');
      const b = new EventOutbox('app-b');
      await a.open();
      await b.open();

      const entry: OutboxEntry = {
        id: 'tab-1-1',
        type: 'ping',
        payload: null,
        priority: 0,
        createdAt: Date.now(),
        status: 'pending',
        sourceTabId: 'tab-1',
      };
      await a.put(entry);

      // Channel A sees the entry; channel B does not.
      expect(await a.readPending()).toHaveLength(1);
      expect(await b.readPending()).toHaveLength(0);

      await a.close();
      await b.close();
    });
  });

  describe('catch-up drain on hub startup (check #16)', () => {
    it('outbox readPending exposes pre-existing pending entries to a fresh reader', async () => {
      // Simulate a previous worker session that wrote a pending entry then died.
      const writer = new EventOutbox('catchup-channel');
      await writer.open();
      await writer.put({
        id: 'previous-session-event',
        type: 'cart.add',
        payload: { sku: 'X' },
        priority: 0,
        createdAt: Date.now(),
        status: 'pending',
        sourceTabId: 'old-tab',
      });
      await writer.close();

      // Fresh outbox instance against the same channel — the new "hub session".
      const reader = new EventOutbox('catchup-channel');
      await reader.open();
      const pending = await reader.readPending();
      expect(pending.map((e) => e.id)).toContain('previous-session-event');
      await reader.close();
    });
  });

  describe('stop flush (check #21 supplement)', () => {
    it('stop() awaits hub.flush before disconnecting', async () => {
      const mesh = new TabMesh({ channelName: 'stop-flush' });
      const flushOrder: string[] = [];
      const hub = {
        ...createMockHub(),
        async flush() {
          flushOrder.push('flush');
        },
        async disconnect() {
          flushOrder.push('disconnect');
        },
      } as unknown as Hub;
      vi.spyOn(mesh as unknown as { createHub(): Hub }, 'createHub').mockReturnValue(hub);

      await mesh.start();
      await mesh.stop();
      expect(flushOrder).toEqual(['flush', 'disconnect']);
    });
  });
});
