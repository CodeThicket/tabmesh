import { TabMesh } from '@tabmesh/core';
import { WebSocketTransport } from '@tabmesh/transport-websocket';

const params = new URLSearchParams(window.location.search);

// `?hub=elected` forces ElectedLeaderHub by hiding SharedWorker from feature
// detection. Useful for comparing the two hub implementations side by side.
if (params.get('hub') === 'elected') {
  (globalThis as unknown as { SharedWorker?: unknown }).SharedWorker = undefined;
}

const transportUrl =
  params.get('ws') ??
  (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_TABMESH_WS_URL ??
  'wss://ws.postman-echo.com/raw';

export const mesh = new TabMesh({
  channelName: 'playground-todos',
  transport: new WebSocketTransport({ url: transportUrl }),
});
