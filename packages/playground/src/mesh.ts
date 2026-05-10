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

// Test-only knobs — accept overrides from URL params so the Playwright
// harness can exercise short-timeout scenarios without modifying production
// defaults. Apps that want to tune these in production should pass them via
// TabMeshConfig directly.
const staleTimeoutMs = numberFromParam('staleTimeoutMs');
const pingMs = numberFromParam('pingMs');

export const mesh = new TabMesh({
  channelName: 'playground-todos',
  transport: new WebSocketTransport({ url: transportUrl }),
  ...(staleTimeoutMs !== undefined ? { staleTimeoutMs } : {}),
  ...(pingMs !== undefined ? { pingMs } : {}),
});

function numberFromParam(name: string): number | undefined {
  const raw = params.get(name);
  if (raw == null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
