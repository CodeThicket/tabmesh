import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventIdGenerator, getTabId } from '../src/tab-id';

describe('getTabId', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should generate an 8-character hex string', () => {
    const id = getTabId('test-channel');
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should return the same ID for the same channel on subsequent calls', () => {
    const id1 = getTabId('test-channel');
    const id2 = getTabId('test-channel');
    expect(id1).toBe(id2);
  });

  it('should return different IDs for different channels', () => {
    const id1 = getTabId('channel-a');
    const id2 = getTabId('channel-b');
    expect(id1).not.toBe(id2);
  });

  it('should persist in sessionStorage', () => {
    const id = getTabId('test-channel');
    const stored = sessionStorage.getItem('tabmesh:tabId:test-channel');
    expect(stored).toBe(id);
  });

  it('should generate a volatile ID when sessionStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('sessionStorage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('sessionStorage disabled');
    });

    const id = getTabId('test-channel');
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('EventIdGenerator', () => {
  it('should generate IDs in format tabId-counter', () => {
    const gen = new EventIdGenerator('abcd1234');
    expect(gen.next()).toBe('abcd1234-1');
    expect(gen.next()).toBe('abcd1234-2');
    expect(gen.next()).toBe('abcd1234-3');
  });

  it('should produce monotonically increasing counters', () => {
    const gen = new EventIdGenerator('test');
    const ids = Array.from({ length: 100 }, () => gen.next());
    for (let i = 1; i < ids.length; i++) {
      const prev = ids[i - 1] ?? '';
      const curr = ids[i] ?? '';
      const prevCounter = Number.parseInt(prev.split('-')[1] ?? '0', 10);
      const currCounter = Number.parseInt(curr.split('-')[1] ?? '0', 10);
      expect(currCounter).toBe(prevCounter + 1);
    }
  });
});
