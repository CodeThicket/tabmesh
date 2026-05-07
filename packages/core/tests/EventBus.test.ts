import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/bus/EventBus';
import type { HubMessage } from '../src/types';

// Mock BroadcastChannel since jsdom doesn't support it
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  closed = false;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    // Deliver to all OTHER instances with the same name
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

beforeEach(() => {
  MockBroadcastChannel.instances = [];
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EventBus', () => {
  it('should open and close', () => {
    const bus = new EventBus('test');
    expect(bus.isOpen).toBe(false);
    bus.open();
    expect(bus.isOpen).toBe(true);
    bus.close();
    expect(bus.isOpen).toBe(false);
  });

  it('should not open if already open', () => {
    const bus = new EventBus('test');
    bus.open();
    bus.open(); // Should not throw
    expect(bus.isOpen).toBe(true);
    bus.close();
  });

  it('should throw when opening after close', () => {
    const bus = new EventBus('test');
    bus.close();
    expect(() => bus.open()).toThrow('EventBus has been closed');
  });

  it('should throw when broadcasting without opening', () => {
    const bus = new EventBus('test');
    expect(() => bus.broadcast({ kind: 'ping', tabId: 'test' })).toThrow('EventBus is not open');
  });

  it('should receive messages from other instances on the same channel', () => {
    const bus1 = new EventBus('test');
    const bus2 = new EventBus('test');
    bus1.open();
    bus2.open();

    const received: HubMessage[] = [];
    bus2.on('ping', (msg) => {
      received.push(msg);
    });

    const message: HubMessage = { kind: 'ping', tabId: 'tab1' };
    bus1.broadcast(message);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(message);

    bus1.close();
    bus2.close();
  });

  it('should not receive its own broadcasts (only others)', () => {
    const bus = new EventBus('test');
    bus.open();

    const received: HubMessage[] = [];
    bus.on('ping', (msg) => {
      received.push(msg);
    });

    bus.broadcast({ kind: 'ping', tabId: 'self' });

    // BroadcastChannel does not deliver to the same instance
    expect(received).toHaveLength(0);

    bus.close();
  });

  it('should dispatch locally with broadcastAndDispatchLocally', () => {
    const bus = new EventBus('test');
    bus.open();

    const received: HubMessage[] = [];
    bus.on('ping', (msg) => {
      received.push(msg);
    });

    bus.broadcastAndDispatchLocally({ kind: 'ping', tabId: 'self' });

    expect(received).toHaveLength(1);

    bus.close();
  });

  it('should support unsubscribing', () => {
    const bus = new EventBus('test');
    bus.open();

    const received: HubMessage[] = [];
    const unsub = bus.on('ping', (msg) => {
      received.push(msg);
    });

    bus.broadcastAndDispatchLocally({ kind: 'ping', tabId: 'test' });
    expect(received).toHaveLength(1);

    unsub();

    bus.broadcastAndDispatchLocally({ kind: 'ping', tabId: 'test' });
    expect(received).toHaveLength(1); // No new messages

    bus.close();
  });

  it('should support wildcard handler via onAny', () => {
    const bus = new EventBus('test');
    bus.open();

    const received: HubMessage[] = [];
    bus.onAny((msg) => {
      received.push(msg);
    });

    bus.broadcastAndDispatchLocally({ kind: 'ping', tabId: 'test' });
    bus.broadcastAndDispatchLocally({ kind: 'pong', tabId: 'test' });

    expect(received).toHaveLength(2);
    expect(received[0]!.kind).toBe('ping');
    expect(received[1]!.kind).toBe('pong');

    bus.close();
  });

  it('should not break if a handler throws', () => {
    const bus = new EventBus('test');
    bus.open();

    const received: HubMessage[] = [];
    bus.on('ping', () => {
      throw new Error('handler error');
    });
    bus.on('ping', (msg) => {
      received.push(msg);
    });

    bus.broadcastAndDispatchLocally({ kind: 'ping', tabId: 'test' });

    // Second handler should still be called
    expect(received).toHaveLength(1);

    bus.close();
  });

  it('should clear all handlers on close', () => {
    const bus = new EventBus('test');
    bus.open();

    const received: HubMessage[] = [];
    bus.on('ping', (msg) => {
      received.push(msg);
    });
    bus.onAny((msg) => {
      received.push(msg);
    });

    bus.close();

    // Can't dispatch after close since channel is gone
    expect(bus.isOpen).toBe(false);
  });

  it('should not deliver to instances on different channels', () => {
    const bus1 = new EventBus('channel-a');
    const bus2 = new EventBus('channel-b');
    bus1.open();
    bus2.open();

    const received: HubMessage[] = [];
    bus2.on('ping', (msg) => {
      received.push(msg);
    });

    bus1.broadcast({ kind: 'ping', tabId: 'test' });

    expect(received).toHaveLength(0);

    bus1.close();
    bus2.close();
  });
});
