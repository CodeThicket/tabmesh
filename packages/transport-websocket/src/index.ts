/**
 * @tabmesh/transport-websocket — WebSocket transport adapter for TabMesh.
 *
 * @example
 * ```typescript
 * import { TabMesh } from '@tabmesh/core';
 * import { WebSocketTransport } from '@tabmesh/transport-websocket';
 *
 * const mesh = new TabMesh({
 *   channelName: 'my-app',
 *   transport: new WebSocketTransport({
 *     url: 'wss://api.example.com/events',
 *   }),
 * });
 * ```
 *
 * @packageDocumentation
 */

export { WebSocketTransport } from './WebSocketTransport.js';
export type { WebSocketTransportConfig } from './WebSocketTransport.js';
