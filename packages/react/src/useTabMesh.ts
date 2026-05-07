import type { OutboundEvent, TabMesh, TabMeshStatus } from '@tabmesh/core';
import { useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import { TabMeshContext } from './TabMeshProvider.js';

/** Return type of the useTabMesh hook. */
export interface UseTabMeshReturn {
  /** Current mesh status. */
  status: TabMeshStatus;
  /**
   * Send an event through the mesh.
   * Stable reference — safe to use in dependency arrays.
   */
  send: <T = unknown>(event: OutboundEvent<T>) => Promise<void>;
}

/** Shallow-compare two TabMeshStatus objects. */
function statusEqual(a: TabMeshStatus, b: TabMeshStatus): boolean {
  return (
    a.started === b.started &&
    a.hubMode === b.hubMode &&
    a.hubConnected === b.hubConnected &&
    a.role === b.role &&
    a.transportState === b.transportState &&
    a.tabId === b.tabId &&
    a.degraded === b.degraded
  );
}

/**
 * React hook for accessing TabMesh status and sending events.
 *
 * Accepts an optional TabMesh instance. If omitted, falls back to
 * the nearest `TabMeshProvider` context.
 *
 * @example
 * ```tsx
 * function App() {
 *   const { status, send } = useTabMesh(meshInstance);
 *   return (
 *     <div>
 *       <p>Connected: {status.hubConnected ? 'Yes' : 'No'}</p>
 *       <button onClick={() => send({ type: 'ping', payload: null })}>Ping</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTabMesh(instance?: TabMesh): UseTabMeshReturn {
  const contextMesh = useContext(TabMeshContext);
  const mesh = instance ?? contextMesh;

  if (!mesh) {
    throw new Error(
      'useTabMesh: No TabMesh instance provided. ' +
        'Pass a TabMesh instance as an argument or wrap your app with <TabMeshProvider>.'
    );
  }

  // Cache the status reference so useSyncExternalStore doesn't infinite-loop.
  // getSnapshot must return the same reference when nothing has changed.
  const cachedStatus = useRef<TabMeshStatus>(mesh.getStatus());

  const getSnapshot = useCallback(() => {
    const next = mesh.getStatus();
    if (!statusEqual(cachedStatus.current, next)) {
      cachedStatus.current = next;
    }
    return cachedStatus.current;
  }, [mesh]);

  // Subscribe to system events that may change status.
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const unsub = mesh.on('*', onStoreChange);
      return unsub;
    },
    [mesh]
  );

  const status = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const send = useCallback(<T = unknown>(event: OutboundEvent<T>) => mesh.send(event), [mesh]);

  return { status, send };
}
