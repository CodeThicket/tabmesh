/**
 * TabMesh - Frontend Event Mesh
 *
 * Main entry point for the TabMesh library.
 * Provides cross-tab coordination, leader election, and shared backend connections.
 *
 * @example Basic usage
 * ```typescript
 * import { TabMesh } from '@tabmesh/core';
 *
 * const mesh = new TabMesh({ channelName: 'my-app' });
 * await mesh.start();
 *
 * await mesh.send({ type: 'ping', payload: 'hello' });
 * mesh.on('ping', (event) => console.log(event.payload));
 * ```
 *
 * @packageDocumentation
 */

export const version = '0.0.1';

// Core
export { TabMesh } from './TabMesh.js';

// Types
export type {
  DeliveryStatus,
  EventHandler,
  EventSource,
  Hub,
  HubMessage,
  HubMode,
  InternalSource,
  LeaderConfig,
  OutboundEvent,
  OutboxEntry,
  PersistenceConfig,
  ReconnectConfig,
  ServiceWorkerConfig,
  SystemEventType,
  TabMeshConfig,
  TabMeshEvent,
  TabMeshStatus,
  TabRole,
  TabVisibilityState,
  Transport,
  TransportState,
  Unsubscribe,
} from './types.js';
export { PROTOCOL_VERSION } from './types.js';

// Errors
export { ErrorCode, TabMeshError } from './errors.js';
export type { ErrorCodeType } from './errors.js';

// Sub-modules (also available as separate entry points)
export { EventBus } from './bus/EventBus.js';
export { EventOutbox } from './storage/EventOutbox.js';
export { LeaderElectionEngine } from './leader/LeaderElectionEngine.js';
export type { LeaderElectionCallbacks } from './leader/LeaderElectionEngine.js';
export { TransportManager } from './transport/TransportManager.js';
export type { TransportManagerCallbacks } from './transport/TransportManager.js';
export { SharedWorkerHub } from './hub/SharedWorkerHub.js';
export { ElectedLeaderHub } from './hub/ElectedLeaderHub.js';

// Service Worker
export { ServiceWorkerClient } from './service-worker/ServiceWorkerClient.js';

// Utilities
export { EventIdGenerator, getTabId } from './tab-id.js';
