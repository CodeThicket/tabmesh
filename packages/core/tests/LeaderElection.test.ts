import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaderElectionEngine } from '../src/leader/LeaderElectionEngine';
import type { LeaderElectionCallbacks } from '../src/leader/LeaderElectionEngine';

// Mock BroadcastChannel
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this && instance.name === this.name && !instance.closed) {
        if (instance.onmessage) {
          instance.onmessage(new MessageEvent('message', { data }));
        }
      }
    }
  }

  close(): void {
    this.closed = true;
    const idx = MockBroadcastChannel.instances.indexOf(this);
    if (idx >= 0) {
      MockBroadcastChannel.instances.splice(idx, 1);
    }
  }
}

function createCallbacks(): LeaderElectionCallbacks & {
  becameLeader: number[];
  becameFollower: Array<{ tabId: string; term: number }>;
  leaderChanged: Array<{ tabId: string; term: number }>;
} {
  return {
    becameLeader: [],
    becameFollower: [],
    leaderChanged: [],
    onBecomeLeader(term: number) {
      this.becameLeader.push(term);
    },
    onBecomeFollower(tabId: string, term: number) {
      this.becameFollower.push({ tabId, term });
    },
    onLeaderChanged(tabId: string, term: number) {
      this.leaderChanged.push({ tabId, term });
    },
  };
}

describe('LeaderElectionEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockBroadcastChannel.instances = [];
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    // Remove navigator.locks to force broadcast-heartbeat strategy
    const nav = { ...navigator };
    (nav as Record<string, unknown>).locks = undefined;
    vi.stubGlobal('navigator', nav);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('strategy selection', () => {
    it('should select broadcast-heartbeat when Web Locks is unavailable', () => {
      const cb = createCallbacks();
      const engine = new LeaderElectionEngine('test', 'tab1', cb);
      expect(engine.activeStrategy).toBe('broadcast-heartbeat');
    });

    it('should respect explicit strategy override', () => {
      const cb = createCallbacks();
      const engine = new LeaderElectionEngine('test', 'tab1', cb, {
        strategy: 'indexeddb-heartbeat',
      });
      expect(engine.activeStrategy).toBe('indexeddb-heartbeat');
    });
  });

  describe('broadcast-heartbeat strategy', () => {
    it('should become leader when no other tabs exist', async () => {
      const cb = createCallbacks();
      const engine = new LeaderElectionEngine('test', 'tab1', cb, {
        strategy: 'broadcast-heartbeat',
      });

      await engine.start();

      // Wait for the 1.5s silence timeout
      await vi.advanceTimersByTimeAsync(1600);

      expect(engine.leader).toBe(true);
      expect(engine.leaderTabId).toBe('tab1');
      expect(cb.becameLeader).toHaveLength(1);

      await engine.stop();
    });

    it('should become follower when another tab is already leader', async () => {
      const cb1 = createCallbacks();
      const engine1 = new LeaderElectionEngine('test', 'tab1', cb1, {
        strategy: 'broadcast-heartbeat',
      });

      // First tab becomes leader
      await engine1.start();
      await vi.advanceTimersByTimeAsync(1600);
      expect(engine1.leader).toBe(true);

      // Second tab joins
      const cb2 = createCallbacks();
      const engine2 = new LeaderElectionEngine('test', 'tab2', cb2, {
        strategy: 'broadcast-heartbeat',
      });
      await engine2.start();

      // Leader heartbeat should reach tab2 within 500ms
      await vi.advanceTimersByTimeAsync(600);

      // tab2 should recognize tab1 as leader
      expect(engine2.leader).toBe(false);

      await engine1.stop();
      await engine2.stop();
    });

    it('should return correct term number', async () => {
      const cb = createCallbacks();
      const engine = new LeaderElectionEngine('test', 'tab1', cb, {
        strategy: 'broadcast-heartbeat',
      });

      await engine.start();
      await vi.advanceTimersByTimeAsync(1600);

      expect(engine.term).toBeGreaterThan(0);

      await engine.stop();
    });

    it('should stop cleanly', async () => {
      const cb = createCallbacks();
      const engine = new LeaderElectionEngine('test', 'tab1', cb, {
        strategy: 'broadcast-heartbeat',
      });

      await engine.start();
      await vi.advanceTimersByTimeAsync(1600);
      expect(engine.leader).toBe(true);

      await engine.stop();
      expect(engine.leader).toBe(false);
    });

    it('should not start twice', async () => {
      const cb = createCallbacks();
      const engine = new LeaderElectionEngine('test', 'tab1', cb, {
        strategy: 'broadcast-heartbeat',
      });

      await engine.start();
      await engine.start(); // Should be no-op
      await vi.advanceTimersByTimeAsync(1600);

      expect(cb.becameLeader).toHaveLength(1); // Only one callback

      await engine.stop();
    });

    it('should not stop twice', async () => {
      const cb = createCallbacks();
      const engine = new LeaderElectionEngine('test', 'tab1', cb, {
        strategy: 'broadcast-heartbeat',
      });

      await engine.start();
      await engine.stop();
      await engine.stop(); // Should be no-op, no error
    });
  });
});
