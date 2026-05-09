import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabMeshProvider } from '../src/TabMeshProvider';
import { useTabMesh } from '../src/useTabMesh';
import { useTabMeshEvent } from '../src/useTabMeshEvent';

// ---------------------------------------------------------------------------
// Mock TabMesh
// ---------------------------------------------------------------------------

interface MockTabMesh {
  _listeners: Map<string, Set<(event: unknown) => void>>;
  _status: {
    started: boolean;
    hubMode: string | null;
    hubConnected: boolean;
    role: string | null;
    transportState: string;
    tabId: string;
    degraded: boolean;
  };
  getStatus: () => MockTabMesh['_status'];
  on: (type: string, handler: (event: unknown) => void) => () => void;
  send: (event: { type: string; payload: unknown }) => Promise<void>;
  _emit: (type: string, event: unknown) => void;
  _setStatus: (partial: Partial<MockTabMesh['_status']>) => void;
}

function createMockMesh(): MockTabMesh {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const status = {
    started: true,
    hubMode: 'shared-worker' as string | null,
    hubConnected: true,
    role: 'follower' as string | null,
    transportState: 'connected',
    tabId: 'abc12345',
    degraded: false,
  };

  const mesh: MockTabMesh = {
    _listeners: listeners,
    _status: status,

    getStatus() {
      return { ...status };
    },

    on(type: string, handler: (event: unknown) => void) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
        if (set.size === 0) {
          listeners.delete(type);
        }
      };
    },

    send: vi.fn(async () => {}),

    _emit(type: string, event: unknown) {
      // Notify type-specific listeners
      const typeSet = listeners.get(type);
      if (typeSet) {
        for (const fn of typeSet) fn(event);
      }
      // Notify wildcard listeners
      const wildcard = listeners.get('*');
      if (wildcard) {
        for (const fn of wildcard) fn(event);
      }
    },

    _setStatus(partial: Partial<MockTabMesh['_status']>) {
      Object.assign(status, partial);
    },
  };

  return mesh;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TabMeshProvider + useTabMesh', () => {
  let mesh: MockTabMesh;

  beforeEach(() => {
    mesh = createMockMesh();
  });

  it('provides mesh via context to useTabMesh', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TabMeshProvider mesh={mesh as never}>{children}</TabMeshProvider>
    );

    const { result } = renderHook(() => useTabMesh(), { wrapper });

    expect(result.current.status.started).toBe(true);
    expect(result.current.status.tabId).toBe('abc12345');
    expect(typeof result.current.send).toBe('function');
  });

  it('useTabMesh prefers explicit instance over context', () => {
    const ctxMesh = createMockMesh();
    ctxMesh._setStatus({ tabId: 'ctx-tab' });

    const directMesh = createMockMesh();
    directMesh._setStatus({ tabId: 'direct-tab' });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <TabMeshProvider mesh={ctxMesh as never}>{children}</TabMeshProvider>
    );

    const { result } = renderHook(() => useTabMesh(directMesh as never), { wrapper });

    expect(result.current.status.tabId).toBe('direct-tab');
  });

  it('useTabMesh throws without instance or provider', () => {
    expect(() => {
      renderHook(() => useTabMesh());
    }).toThrow(/No TabMesh instance provided/);
  });

  it('useTabMesh.send delegates to mesh.send', async () => {
    const { result } = renderHook(() => useTabMesh(mesh as never));

    await act(async () => {
      await result.current.send({ type: 'test', payload: 'data' });
    });

    expect(mesh.send).toHaveBeenCalledWith({ type: 'test', payload: 'data' });
  });

  it('useTabMesh re-renders on status change via wildcard subscription', () => {
    const { result } = renderHook(() => useTabMesh(mesh as never));

    expect(result.current.status.hubConnected).toBe(true);

    // Simulate status change + wildcard event that triggers re-render
    act(() => {
      mesh._setStatus({ hubConnected: false });
      mesh._emit('hub.disconnected', {});
    });

    expect(result.current.status.hubConnected).toBe(false);
  });
});

describe('useTabMeshEvent', () => {
  let mesh: MockTabMesh;

  beforeEach(() => {
    mesh = createMockMesh();
  });

  it('subscribes to events with explicit instance', () => {
    const handler = vi.fn();

    renderHook(() => useTabMeshEvent(mesh as never, 'chat.message', handler));

    const event = { type: 'chat.message', payload: { text: 'hello' } };
    act(() => {
      mesh._emit('chat.message', event);
    });

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('subscribes to events via context', () => {
    const handler = vi.fn();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <TabMeshProvider mesh={mesh as never}>{children}</TabMeshProvider>
    );

    renderHook(() => useTabMeshEvent('chat.message', handler), { wrapper });

    const event = { type: 'chat.message', payload: { text: 'hi' } };
    act(() => {
      mesh._emit('chat.message', event);
    });

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('throws without instance or provider', () => {
    const handler = vi.fn();

    expect(() => {
      renderHook(() => useTabMeshEvent('test', handler));
    }).toThrow(/No TabMesh instance provided/);
  });

  it('unsubscribes on unmount', () => {
    const handler = vi.fn();

    const { unmount } = renderHook(() => useTabMeshEvent(mesh as never, 'chat.message', handler));

    // Fires before unmount
    act(() => {
      mesh._emit('chat.message', { type: 'chat.message', payload: 1 });
    });
    expect(handler).toHaveBeenCalledTimes(1);

    unmount();

    // Should not fire after unmount
    mesh._emit('chat.message', { type: 'chat.message', payload: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('uses latest handler ref without re-subscribing', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const { rerender } = renderHook(
      ({ handler }) => useTabMeshEvent(mesh as never, 'test', handler),
      { initialProps: { handler: handler1 } }
    );

    // Re-render with new handler
    rerender({ handler: handler2 });

    const event = { type: 'test', payload: 'data' };
    act(() => {
      mesh._emit('test', event);
    });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledWith(event);
  });
});
