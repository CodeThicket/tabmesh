# React

`@tabmesh/react` ships three pieces:

- `<TabMeshProvider>` — context provider for the mesh instance
- `useTabMesh()` — returns `{ status, send }` and re-renders when status changes
- `useTabMeshEvent(type, handler)` — subscribe to an event type (or `'*'` for all)

The package is small (~40 lines) and stays close to the underlying `mesh.on()` / `mesh.getStatus()` API.

## Setup

```bash
pnpm install @tabmesh/core @tabmesh/transport-websocket @tabmesh/react
```

Create the mesh in its own module so it's a singleton:

```ts
// src/mesh.ts
import { TabMesh } from '@tabmesh/core';
import { WebSocketTransport } from '@tabmesh/transport-websocket';

export const mesh = new TabMesh({
  channelName: 'my-app',
  transport: new WebSocketTransport({ url: 'wss://api.example.com' }),
  workerVersion: import.meta.env.VITE_GIT_SHA,
});

await mesh.start();
```

Wrap your app in `<TabMeshProvider>`:

```tsx
// src/main.tsx
import { createRoot } from 'react-dom/client';
import { TabMeshProvider } from '@tabmesh/react';
import { mesh } from './mesh';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <TabMeshProvider mesh={mesh}>
    <App />
  </TabMeshProvider>,
);
```

::: tip Provider is optional
If you'd rather not use context, every hook accepts the `mesh` instance as its first argument:

```tsx
const { status, send } = useTabMesh(mesh);
useTabMeshEvent(mesh, 'chat.message', handler);
```

Use the provider when most components need the same mesh; pass explicitly for one-off cases or testing.
:::

## `useTabMesh`

Returns the current status and a stable `send` function. Re-renders when status changes (hub-connected, transport-state, role, degraded, etc.).

```tsx
import { useTabMesh } from '@tabmesh/react';

function StatusBar() {
  const { status, send } = useTabMesh();

  return (
    <div>
      Hub: {status.hubMode} · Transport: {status.transportState}
      <button
        onClick={() =>
          send({ type: 'ping', payload: { at: Date.now() } })
        }
      >
        Ping
      </button>
    </div>
  );
}
```

The returned `send` reference is stable across renders — safe to use in `useEffect` dependency arrays.

The full `status` shape:

```ts
{
  started: boolean;
  hubMode: 'shared-worker' | 'elected-leader' | 'degraded' | null;
  hubConnected: boolean;
  role: 'hub' | 'follower' | null;          // 'hub' = elected leader in fallback mode
  transportState: 'connected' | 'disconnected' | 'reconnecting';
  tabId: string;
  degraded: boolean;
  leaderTabId?: string | null;              // only set in elected-leader mode
  term?: number;                            // election term, only in fallback mode
}
```

## `useTabMeshEvent`

Subscribes to an event type. The handler fires for every matching event from any tab (including this one — filter on `event.source` if you want remote-only).

```tsx
import { useTabMeshEvent } from '@tabmesh/react';

function Inbox() {
  const [messages, setMessages] = useState<Message[]>([]);

  useTabMeshEvent('chat.message', (event) => {
    setMessages((prev) => [...prev, event.payload]);
  });

  return <ul>{messages.map(...)}</ul>;
}
```

The handler is automatically unsubscribed on unmount. The latest handler ref is always used, so closures over fresh state work without re-subscribing:

```tsx
function Counter() {
  const [count, setCount] = useState(0);

  // Closure captures fresh `count` every render — no stale-closure bug.
  useTabMeshEvent('ping', () => {
    console.log(`Got ping, current count is ${count}`);
  });

  return <button onClick={() => setCount(count + 1)}>+</button>;
}
```

### Wildcard subscription

Pass `'*'` to receive every event including the [system events](/reference/system-events):

```tsx
useTabMeshEvent('*', (event) => {
  if (event.type.startsWith('transport.')) {
    console.log('Transport state change:', event.type, event.payload);
  }
});
```

The playground's activity feed is built on this — it shows the live event stream as a debug surface.

## Patterns

### Showing connection status

```tsx
function ConnectionBadge() {
  const { status } = useTabMesh();

  if (!status.started) return <Badge>Offline</Badge>;
  if (status.transportState === 'connected') return <Badge variant="ok">Live</Badge>;
  if (status.transportState === 'reconnecting') return <Badge variant="warn">Reconnecting…</Badge>;
  return <Badge variant="error">Disconnected</Badge>;
}
```

### Reacting to remote events only

```tsx
useTabMeshEvent('todo.completed', (event) => {
  if (event.source === 'local') return; // already handled in the local UI
  showToast(`Another tab completed: ${event.payload.title}`);
});
```

### Logout flow

The recommended sequence is documented in [Recipes → Auth & logout](/recipes/auth-and-logout). In a React hook:

```tsx
function useLogout() {
  return useCallback(async () => {
    await mesh.clearOutbox();
    await mesh.disconnectTransport();
    mesh.broadcast({ type: 'auth.logout', payload: {} });
    await mesh.stop();
    window.location.href = '/login';
  }, []);
}
```

## What's next

→ [Configuration reference](/reference/config)
→ [System events](/reference/system-events)
→ [Recipes](/recipes/) — common React patterns
