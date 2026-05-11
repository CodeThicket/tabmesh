# Getting Started

This walkthrough takes you from `npm install` to events flowing across two tabs in about five minutes. It assumes you're using Vite — adjust paths for Webpack, Next, or Turbopack as noted.

## 1. Install

```bash
pnpm install @tabmesh/core @tabmesh/transport-websocket
# or: npm install / yarn add
```

If you're using React, also install the hooks package:

```bash
pnpm install @tabmesh/react
```

## 2. Deploy the SharedWorker bundle

This is the step most easily missed. TabMesh's `SharedWorker` script needs to be served from your app's origin at a stable URL — it's a separate file, not bundled into your JavaScript.

`@tabmesh/core` ships the pre-built bundle inside its `dist/`. Copy it into your app's static-asset directory:

::: code-group

```bash [Vite / generic SPA]
cp node_modules/@tabmesh/core/dist/tabmesh-worker.js public/
```

```bash [Next.js]
cp node_modules/@tabmesh/core/dist/tabmesh-worker.js public/
# Files in public/ are served at the URL root, so this becomes /tabmesh-worker.js
```

```bash [Webpack with copy-webpack-plugin]
# webpack.config.js
new CopyPlugin({
  patterns: [
    { from: 'node_modules/@tabmesh/core/dist/tabmesh-worker.js', to: '.' },
  ],
}),
```

:::

::: tip Automate it
Add the copy step to your `build` and `dev` scripts so you never forget. Whenever you upgrade `@tabmesh/core`, the new bundle is copied automatically.
:::

The default `workerUrl` is `/tabmesh-worker.js`. If you serve it elsewhere (e.g. behind a CDN at `/_static/tabmesh-worker.js`), pass `workerUrl: '/_static/tabmesh-worker.js'` to the constructor.

## 3. Construct and start the mesh

```ts
import { TabMesh } from '@tabmesh/core';
import { WebSocketTransport } from '@tabmesh/transport-websocket';

const mesh = new TabMesh({
  channelName: 'my-app',
  transport: new WebSocketTransport({ url: 'wss://api.example.com/events' }),
  // Strongly recommended in production. See the gotcha on SharedWorker
  // name caching for why.
  workerVersion: process.env.GIT_SHA,
});

await mesh.start();
```

`channelName` is the only required field. It scopes the SharedWorker name, the IndexedDB database, and the BroadcastChannel — pick something unique to your app, and incorporate session identity if you serve multiple tenants on the same origin (e.g. `'my-app:tenant-42'`).

`mesh.start()` is async because it has to handshake with the SharedWorker. It resolves successfully even if the transport fails to connect — the mesh keeps retrying in the background and you can subscribe to `transport.*` events to react.

## 4. Send and receive events

```ts
// Subscribe — this handler fires for events from this tab AND from other tabs.
mesh.on('chat.message', (event) => {
  console.log(event.payload, 'source:', event.source);
});

// Send — reaches the backend AND every other tab on the same origin.
await mesh.send({
  type: 'chat.message',
  payload: { text: 'Hello' },
});
```

The handler's `event.source` is `'local'` when the event came from this tab and `'remote'` when it came from another tab or the backend. You can filter:

```ts
mesh.on('chat.message', (event) => {
  if (event.source === 'remote') {
    showNotification(`New message: ${event.payload.text}`);
  }
});
```

## 5. Open two tabs

Open your app in two browser tabs at the same origin. Send an event from one — the other receives it as `source: 'remote'`. Inspect the network tab: there's only **one** WebSocket, regardless of how many tabs are open. That's a `SharedWorker` doing its job.

## React quickstart

If you're using `@tabmesh/react`:

```tsx
import { TabMeshProvider, useTabMesh, useTabMeshEvent } from '@tabmesh/react';
import { mesh } from './mesh'; // your TabMesh instance

function App() {
  return (
    <TabMeshProvider mesh={mesh}>
      <Chat />
    </TabMeshProvider>
  );
}

function Chat() {
  const { status, send } = useTabMesh();

  useTabMeshEvent('chat.message', (event) => {
    // handle incoming
  });

  return (
    <div>
      <p>Hub: {status.hubMode}, transport: {status.transportState}</p>
      <button onClick={() => send({ type: 'chat.message', payload: { text: 'hi' } })}>
        Send
      </button>
    </div>
  );
}
```

The provider is optional — you can also pass the `mesh` instance directly as the first argument to each hook.

→ [Full React guide](./react)

## Troubleshooting

**"Failed to construct 'SharedWorker'" / 404 on `/tabmesh-worker.js`**
You skipped step 2 or the file isn't being served. Check the network tab for the request to `/tabmesh-worker.js` and verify the response is a 200 with a JavaScript MIME type.

**"Transport is reconnecting" forever**
Check `wss://` URL is correct and reachable. The mesh logs each reconnect attempt as a `transport.reconnecting` system event — subscribe with `mesh.on('*', console.log)` to watch.

**Events from other tabs aren't appearing**
Verify both tabs are on the **same origin** (protocol + host + port must match). `https://app.example.com:443` and `https://app.example.com` are the same. `https://www.example.com` and `https://example.com` are not.

**Status panel says "Transport: disconnected" even though sends work**
This was a real bug fixed in PR #7. If you're seeing it on a current version, please [open an issue](https://github.com/CodeThicket/tabmesh/issues/new).

## What's next

→ [Architecture](./architecture) — how the SharedWorker, outbox, and elected-leader fallback fit together
→ [Gotchas](./gotchas) — sharp edges to know about before adopting in production (read this!)
→ [Configuration reference](/reference/config) — every field, every default
→ [Try the playground](/playground) — interactive multi-tab demo
