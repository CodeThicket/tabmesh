import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventOutbox } from '../src/storage/EventOutbox';
import type { OutboxEntry } from '../src/types';

function createEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: `tab1-${Math.random().toString(36).slice(2, 8)}`,
    type: 'test.event',
    payload: { data: 'hello' },
    priority: 0,
    createdAt: Date.now(),
    status: 'pending',
    sourceTabId: 'tab1',
    ...overrides,
  };
}

let testCounter = 0;

describe('EventOutbox', () => {
  let outbox: EventOutbox;

  beforeEach(async () => {
    testCounter++;
    outbox = new EventOutbox(`test-channel-${testCounter}`);
    await outbox.open();
  });

  afterEach(() => {
    outbox.close();
  });

  it('should open without degrading', async () => {
    expect(outbox.isDegraded).toBe(false);
  });

  it('should store and read pending events', async () => {
    const entry = createEntry({ id: 'tab1-1' });
    await outbox.put(entry);

    const pending = await outbox.readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('tab1-1');
    expect(pending[0]?.type).toBe('test.event');
    expect(pending[0]?.status).toBe('pending');
  });

  it('should return pending events sorted by priority desc then createdAt asc', async () => {
    const now = Date.now();
    await outbox.put(createEntry({ id: 'low', priority: 0, createdAt: now }));
    await outbox.put(createEntry({ id: 'high', priority: 10, createdAt: now + 1 }));
    await outbox.put(createEntry({ id: 'medium', priority: 5, createdAt: now + 2 }));
    await outbox.put(createEntry({ id: 'high-earlier', priority: 10, createdAt: now - 1 }));

    const pending = await outbox.readPending();
    expect(pending.map((e) => e.id)).toEqual(['high-earlier', 'high', 'medium', 'low']);
  });

  it('should filter out expired events from readPending', async () => {
    const past = Date.now() - 10_000;
    await outbox.put(createEntry({ id: 'expired', createdAt: past, expiresAt: past + 1000 }));
    await outbox.put(createEntry({ id: 'valid' }));

    const pending = await outbox.readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('valid');
  });

  it('should mark events as delivered and clean up', async () => {
    await outbox.put(createEntry({ id: 'e1' }));
    await outbox.put(createEntry({ id: 'e2' }));
    await outbox.put(createEntry({ id: 'e3' }));

    await outbox.markDeliveredAndCleanup(['e1', 'e2']);

    const pending = await outbox.readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('e3');
  });

  it('should update status of a single entry', async () => {
    await outbox.put(createEntry({ id: 'e1' }));
    await outbox.updateStatus('e1', 'delivered');

    const pending = await outbox.readPending();
    expect(pending).toHaveLength(0);
  });

  it('should clear all entries', async () => {
    await outbox.put(createEntry({ id: 'e1' }));
    await outbox.put(createEntry({ id: 'e2' }));

    await outbox.clear();

    const count = await outbox.count();
    expect(count).toBe(0);
  });

  it('should count entries', async () => {
    expect(await outbox.count()).toBe(0);
    await outbox.put(createEntry({ id: 'e1' }));
    expect(await outbox.count()).toBe(1);
    await outbox.put(createEntry({ id: 'e2' }));
    expect(await outbox.count()).toBe(2);
  });

  it('should handle no-op on updateStatus for nonexistent entry', async () => {
    await outbox.updateStatus('nonexistent', 'delivered');
    // Should not throw
  });

  it('cleans up TTL-expired entries on idle markDeliveredAndCleanup([])', async () => {
    const past = Date.now() - 10_000;
    await outbox.put(createEntry({ id: 'expired-1', createdAt: past, expiresAt: past + 1000 }));
    await outbox.put(createEntry({ id: 'valid' }));

    // Empty deliveredIds — this is the path stop()'s flush takes when the
    // queue had nothing new to send. CONTEXT.md still wants TTL-expired
    // pending entries reclaimed in the same transaction.
    await outbox.markDeliveredAndCleanup([]);

    const remaining = await outbox.count();
    expect(remaining).toBe(1);
  });
});

describe('EventOutbox — degraded mode (in-memory)', () => {
  let outbox: EventOutbox;

  beforeEach(() => {
    // Force degraded mode by using a custom outbox with broken indexedDB
    outbox = new EventOutbox('degraded-test');
    // Simulate degraded mode directly
    (outbox as unknown as { degraded: boolean }).degraded = true;
  });

  it('should store and read from memory queue', async () => {
    await outbox.put(createEntry({ id: 'mem-1' }));
    await outbox.put(createEntry({ id: 'mem-2' }));

    const pending = await outbox.readPending();
    expect(pending).toHaveLength(2);
  });

  it('should sort by priority in memory', async () => {
    const now = Date.now();
    await outbox.put(createEntry({ id: 'low', priority: 0, createdAt: now }));
    await outbox.put(createEntry({ id: 'high', priority: 10, createdAt: now }));

    const pending = await outbox.readPending();
    expect(pending[0]?.id).toBe('high');
    expect(pending[1]?.id).toBe('low');
  });

  it('should mark delivered and cleanup in memory', async () => {
    await outbox.put(createEntry({ id: 'e1' }));
    await outbox.put(createEntry({ id: 'e2' }));

    await outbox.markDeliveredAndCleanup(['e1']);

    const pending = await outbox.readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('e2');
  });

  it('should clear memory queue', async () => {
    await outbox.put(createEntry({ id: 'e1' }));
    await outbox.clear();
    expect(await outbox.count()).toBe(0);
  });

  it('should evict when queue is full', async () => {
    // Create outbox with max 3 entries
    const smallOutbox = new EventOutbox('small', { maxQueueSize: 3, defaultTTL: 86400000 });
    (smallOutbox as unknown as { degraded: boolean }).degraded = true;

    await smallOutbox.put(createEntry({ id: 'e1' }));
    await smallOutbox.put(createEntry({ id: 'e2' }));
    await smallOutbox.put(createEntry({ id: 'e3' }));
    await smallOutbox.put(createEntry({ id: 'e4' })); // Should evict e1

    const count = await smallOutbox.count();
    expect(count).toBe(3);
  });

  it('should filter expired events in memory', async () => {
    const past = Date.now() - 10_000;
    await outbox.put(createEntry({ id: 'expired', createdAt: past, expiresAt: past + 1000 }));
    await outbox.put(createEntry({ id: 'valid' }));

    const pending = await outbox.readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('valid');
  });
});
