import type { EventHandler, TabMesh, TabMeshEvent } from '@tabmesh/core';
import { useContext, useEffect, useRef } from 'react';
import { TabMeshContext } from './TabMeshProvider.js';

/**
 * React hook for subscribing to TabMesh events.
 *
 * The handler is automatically subscribed when the component mounts
 * and unsubscribed on unmount. The latest handler ref is always used,
 * so the handler can safely reference state without causing re-subscriptions.
 *
 * @example
 * ```tsx
 * function ChatMessages() {
 *   const [messages, setMessages] = useState([]);
 *
 *   useTabMeshEvent(meshInstance, 'chat.message', (event) => {
 *     setMessages(prev => [...prev, event.payload]);
 *   });
 *
 *   return <ul>{messages.map(m => <li key={m.id}>{m.text}</li>)}</ul>;
 * }
 * ```
 */
export function useTabMeshEvent<T = unknown>(
  instanceOrType: TabMesh | string,
  typeOrHandler: string | EventHandler<T>,
  maybeHandler?: EventHandler<T>
): void {
  // Support two signatures:
  // useTabMeshEvent(mesh, 'type', handler) — explicit instance
  // useTabMeshEvent('type', handler) — context fallback
  const contextMesh = useContext(TabMeshContext);

  let mesh: TabMesh | null;
  let eventType: string;
  let handler: EventHandler<T>;

  if (typeof instanceOrType === 'string') {
    // useTabMeshEvent('type', handler)
    mesh = contextMesh;
    eventType = instanceOrType;
    handler = typeOrHandler as EventHandler<T>;
  } else {
    // useTabMeshEvent(mesh, 'type', handler)
    mesh = instanceOrType;
    eventType = typeOrHandler as string;
    handler = maybeHandler as EventHandler<T>;
  }

  if (!mesh) {
    throw new Error(
      'useTabMeshEvent: No TabMesh instance provided. ' +
        'Pass a TabMesh instance as the first argument or wrap your app with <TabMeshProvider>.'
    );
  }

  // Use a ref to always call the latest handler without re-subscribing
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!mesh) return;

    const unsubscribe = mesh.on<T>(eventType, (event: TabMeshEvent<T>) => {
      handlerRef.current(event);
    });

    return unsubscribe;
  }, [mesh, eventType]);
}
