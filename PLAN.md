# TabMesh: Production-Ready Frontend Event Mesh Library

## Vision

**TabMesh is to frontend applications what Istio is to backend microservices.**

A complete, production-ready event mesh that solves cross-tab coordination, backend connection pooling, offline resilience, and event debugging with zero configuration.

---

## Market Analysis: Why TabMesh?

### Existing Solutions (Competitors)

| Library | Focus | Gaps |
|---------|-------|------|
| **[crosstab](https://github.com/tejacques/crosstab)** | Cross-tab messaging via localStorage | ❌ No backend transport sharing<br>❌ No offline queue<br>❌ No debugging tools |
| **[tab-election](https://www.npmjs.com/package/tab-election)** | Leader election (Locks API) | ❌ Leader election only<br>❌ No event mesh concept<br>❌ No Service Worker support |
| **[broadcast-channel](https://github.com/pubkey/broadcast-channel)** by pubkey | BroadcastChannel with leader election | ❌ No backend transport abstraction<br>❌ No offline queue with TTL<br>❌ No DevTools |
| **[tab-elect](https://github.com/xuset/tab-elect)** | Leader election via IndexedDB | ❌ Basic leader election<br>❌ No complete solution |
| **[across-tabs](https://github.com/wingify/across-tabs)** | Lightweight cross-tab messaging | ❌ No leader concept<br>❌ No persistence |

### TabMesh Unique Value Proposition

✅ **Complete Event Mesh**: All-in-one solution - not 5 separate libraries
✅ **Service Worker Integration**: Background sync even when tabs closed
✅ **Developer Tools First**: Built-in DevTools extension, event timeline, debugging
✅ **Performance Optimized**: Web Workers, batching, compression, smart retries
✅ **Zero Configuration**: Works out of the box with sensible defaults
✅ **Backend Agnostic**: Supports WebSocket, SSE, long-poll, custom transports

**No existing library combines all of these.**

---

## Core Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Thread                               │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────────┐ │
│  │  TabMesh SDK │  │ Event Bus   │  │  Transport Manager     │ │
│  │  (Public API)│◄─┤(Broadcast   │◄─┤ (WebSocket/SSE/Poll)  │ │
│  └──────────────┘  │  Channel)   │  └────────────────────────┘ │
│                    └─────────────┘                              │
└──────────────────────┬────────────────────────────┬─────────────┘
                       │                            │
        ┌──────────────▼────────────┐  ┌───────────▼──────────┐
        │    Service Worker         │  │     Web Worker       │
        │  (Background Sync)        │  │  (Heavy Processing)  │
        │                           │  │                      │
        │  ┌──────────────────────┐ │  │  ┌────────────────┐ │
        │  │  IndexedDB Queue     │ │  │  │  Event Batch   │ │
        │  │  (Offline Events)    │ │  │  │  Compression   │ │
        │  └──────────────────────┘ │  │  └────────────────┘ │
        │  ┌──────────────────────┐ │  │                      │
        │  │  Background Sync API │ │  │                      │
        │  └──────────────────────┘ │  │                      │
        └───────────────────────────┘  └──────────────────────┘
```

### Key Components

1. **Leader Election Engine** - Web Locks API (sub-50ms failover) + fallback
2. **Event Bus** - BroadcastChannel for cross-tab messaging
3. **Transport Manager** - Pluggable transports (WebSocket, SSE, long-poll)
4. **Storage Layer** - IndexedDB with TTL-based cleanup
5. **Service Worker** - Background Sync API, offline queue
6. **Web Worker** - Heavy processing, batching, compression
7. **Developer Tools** - Chrome/Firefox DevTools extension

---

## Package Structure & Bundle Sizes

**Monorepo with fully independent packages** (import only what you need):

```
@tabmesh/
├── core                    # Main SDK (~15KB gzipped, zero dependencies)
│   ├── leader              # Leader election only (~5KB) - tree-shakeable
│   ├── bus                 # Event bus only (~3KB) - tree-shakeable
│   ├── transport           # Transport manager (~7KB) - tree-shakeable
│   └── storage             # IndexedDB queue (~8KB) - optional, lazy-loaded
│
├── transport-websocket     # WebSocket adapter (~3KB)
├── transport-sse           # Server-Sent Events adapter (~2KB)
├── transport-longpoll      # Long-polling adapter (~4KB)
│
├── service-worker          # Service Worker helpers (~6KB) - optional
├── web-worker              # Web Worker helpers (~5KB) - optional
│
├── react                   # React hooks (~2KB)
├── vue                     # Vue composables (~2KB)
├── svelte                  # Svelte stores (~2KB)
│
└── devtools                # Browser extension (dev-only, not bundled)
```

### Bundle Size Examples

**Minimal usage** (just cross-tab messaging):
```typescript
import { EventBus } from '@tabmesh/core/bus';
// Bundle: ~3KB gzipped
```

**With leader election**:
```typescript
import { LeaderElectionEngine } from '@tabmesh/core/leader';
import { EventBus } from '@tabmesh/core/bus';
// Bundle: ~8KB gzipped
```

**Full mesh** (transport + offline + debugging):
```typescript
import { TabMesh } from '@tabmesh/core';
import { WebSocketTransport } from '@tabmesh/transport-websocket';
// Bundle: ~18KB gzipped
```

**With Service Worker + Web Worker**:
```typescript
import { TabMesh } from '@tabmesh/core';
import { ServiceWorkerClient } from '@tabmesh/service-worker';
import { WebWorkerClient } from '@tabmesh/web-worker';
// Bundle: ~24KB gzipped (workers load separately)
```

### Tree-Shaking Guarantees

All packages are **fully tree-shakeable**:

```json
// package.json for each package
{
  "name": "@tabmesh/core",
  "sideEffects": false,
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./leader": {
      "import": "./dist/leader/index.js",
      "types": "./dist/leader/index.d.ts"
    },
    "./bus": {
      "import": "./dist/bus/index.js",
      "types": "./dist/bus/index.d.ts"
    },
    "./transport": {
      "import": "./dist/transport/index.js",
      "types": "./dist/transport/index.d.ts"
    },
    "./storage": {
      "import": "./dist/storage/index.js",
      "types": "./dist/storage/index.d.ts"
    }
  }
}
```

This ensures bundlers (Vite, Webpack, Rollup) **only include what you import**.

---

## Implementation Roadmap (10 Weeks)

### Week 1-2: Core Infrastructure
- Project setup (monorepo, TypeScript, testing)
- Core types & interfaces
- Leader election engine (Web Locks API + IndexedDB fallback)
- Event bus (BroadcastChannel wrapper)

### Week 3: Service Worker Integration
- Service Worker implementation
- Background Sync API integration
- IndexedDB offline queue
- Push notifications support

### Week 4: Web Worker for Performance
- Web Worker for heavy processing
- Event batching
- MessagePack compression
- Event ordering for collaboration (CRDTs)

### Week 5: Developer Tools
- Chrome DevTools extension
- Event timeline viewer
- Export/import functionality
- Performance metrics dashboard

### Week 6: Core TabMesh SDK
- Main TabMesh class orchestrating all components
- Transport manager with reconnection
- Event outbox with TTL cleanup
- Event timeline for debugging

### Week 7: Framework Integrations
- React hooks (`useTabMesh`, `useTabMeshEvent`)
- Vue composables
- Svelte stores
- TypeScript types for all

### Week 8: Testing & Quality
- Unit tests (Vitest + fake-indexeddb)
- Integration tests
- E2E tests (Playwright - 3 tabs, leader election, failover)
- Performance tests (1000 events/sec benchmark)

### Week 9: Documentation & Examples
- Comprehensive docs (VitePress)
- Example apps (chat, collaboration, offline-todo)
- API reference
- Migration guides from competitors

### Week 10: Community & Launch
- GitHub repository setup
- NPM publishing
- Documentation website (Vercel)
- Community building (Discord, Twitter)
- ProductHunt launch

---

## Critical Files to Implement

### Core Package (`@tabmesh/core`)

1. `src/types.ts` - Type definitions (~200 lines)
2. `src/TabMesh.ts` - Main SDK class (~400 lines)
3. `src/leader/LeaderElectionEngine.ts` - Leader election (~300 lines)
4. `src/bus/EventBus.ts` - BroadcastChannel wrapper (~150 lines)
5. `src/transport/TransportManager.ts` - Transport lifecycle (~250 lines)
6. `src/storage/EventOutbox.ts` - IndexedDB queue (~300 lines)
7. `src/timeline/EventTimeline.ts` - Event recording (~200 lines)
8. `src/service-worker/ServiceWorkerClient.ts` - SW integration (~150 lines)
9. `src/worker/WebWorkerClient.ts` - Web Worker client (~150 lines)

### Service Worker (`@tabmesh/worker`)

10. `src/service-worker/tabmesh-sw.ts` - Service Worker (~250 lines)

### Web Worker (`@tabmesh/worker`)

11. `src/web-worker/tabmesh-worker.ts` - Web Worker (~200 lines)

### Transport Packages

12. `@tabmesh/transport-websocket` - WebSocket adapter (~150 lines)
13. `@tabmesh/transport-sse` - SSE adapter (~150 lines)
14. `@tabmesh/transport-longpoll` - Long-poll adapter (~200 lines)

### DevTools (`@tabmesh/devtools`)

15. `src/panel.html` - DevTools panel UI (~200 lines)
16. `src/panel.ts` - DevTools logic (~300 lines)
17. `src/manifest.json` - Extension manifest

### Framework Integrations

18. `@tabmesh/react` - React hooks (~150 lines)
19. `@tabmesh/vue` - Vue composables (~150 lines)
20. `@tabmesh/svelte` - Svelte stores (~150 lines)

**Total: ~4500 lines of production code**

---

## Developer Experience (DX) - Progressive Complexity

### Level 1: Just Cross-Tab Messaging (~3KB)

**Use case**: "I just want tabs to talk to each other"

```typescript
import { EventBus } from '@tabmesh/core/bus';

const bus = new EventBus('my-app');

// Send to other tabs
bus.broadcast({ type: 'ping', data: 'hello' });

// Receive from other tabs
bus.subscribe('ping', (message) => {
  console.log('Received:', message.data);
});
```

**Bundle size**: ~3KB gzipped
**Complexity**: Beginner-friendly

---

### Level 2: Add Leader Election (~8KB)

**Use case**: "I want one tab to be the leader"

```typescript
import { LeaderElectionEngine } from '@tabmesh/core/leader';
import { EventBus } from '@tabmesh/core/bus';

const bus = new EventBus('my-app');
const leader = new LeaderElectionEngine({
  lockName: 'my-app-leader',
  onBecomeLeader: () => {
    console.log('I am the leader!');
    // Open WebSocket connection here
  },
  onBecomeFollower: () => {
    console.log('I am a follower');
  }
});

await leader.start();
```

**Bundle size**: ~8KB gzipped
**Complexity**: Intermediate

---

### Level 3: Full Event Mesh (~18KB)

**Use case**: "I want the complete solution"

```typescript
import { TabMesh } from '@tabmesh/core';
import { WebSocketTransport } from '@tabmesh/transport-websocket';

const mesh = new TabMesh({
  channelName: 'my-app',
  transport: new WebSocketTransport({
    url: 'wss://api.example.com/events'
  })
});

await mesh.start();

// Zero-config, automatic leader election, offline queue, etc.
await mesh.send({ type: 'chat.message', payload: { text: 'Hi!' } });
mesh.on('chat.message', (event) => console.log(event.payload.text));
```

**Bundle size**: ~18KB gzipped
**Complexity**: Advanced (but still simple API)

---

### Level 4: Add Service Worker + Web Worker (~24KB)

**Use case**: "I need offline support and performance"

```typescript
import { TabMesh } from '@tabmesh/core';
import { WebSocketTransport } from '@tabmesh/transport-websocket';

const mesh = new TabMesh({
  channelName: 'my-app',
  transport: new WebSocketTransport({ url: 'wss://api.example.com' }),

  // Optional: Enable Service Worker for offline support
  serviceWorker: {
    enabled: true,
    scriptUrl: '/tabmesh-sw.js'
  },

  // Optional: Enable Web Worker for heavy processing
  webWorker: {
    enabled: true
  }
});

await mesh.start();
```

**Bundle size**: ~24KB gzipped (workers load separately)
**Complexity**: Advanced

---

### Framework Integration (Zero Overhead)

**React** (~2KB extra):
```typescript
import { useTabMesh, useTabMeshEvent } from '@tabmesh/react';

function ChatApp() {
  const { status, send } = useTabMesh(meshInstance);
  const [messages, setMessages] = useState([]);

  useTabMeshEvent('chat.message', (event) => {
    setMessages(prev => [...prev, event.payload]);
  });

  return (
    <div>
      <p>Role: {status.role}</p>
      <button onClick={() => send({ type: 'chat.message', payload: { text: 'Hi' } })}>
        Send
      </button>
    </div>
  );
}
```

**Vue** (~2KB extra):
```typescript
import { useTabMesh } from '@tabmesh/vue';

export default {
  setup() {
    const { status, send } = useTabMesh(meshInstance);
    return { status, send };
  }
}
```

---

## Progressive Enhancement Strategy

**Start simple, add features as needed**:

1. **Week 1**: Import just `EventBus` for basic cross-tab messaging
2. **Week 2**: Add `LeaderElectionEngine` when you need leader coordination
3. **Week 3**: Upgrade to full `TabMesh` for offline support
4. **Week 4**: Enable Service Worker for background sync
5. **Week 5**: Enable Web Worker for performance

**No breaking changes** - each level is fully compatible with the next.

---

## Zero-Config Defaults (But Fully Customizable)

```typescript
// Minimal config (just one line!)
const mesh = new TabMesh({ channelName: 'my-app' });

// Full config (opt-in to advanced features)
const mesh = new TabMesh({
  channelName: 'my-app',

  transport: new WebSocketTransport({
    url: 'wss://api.example.com',
    reconnect: {
      maxAttempts: 10,
      initialDelayMs: 1000,
      backoffMultiplier: 2
    }
  }),

  leader: {
    strategy: 'auto',  // Auto-detect Locks API or fallback
    lockName: 'my-app-leader'
  },

  persistence: {
    enabled: true,
    dbName: 'my-app-queue',
    defaultTTL: 86400000,  // 24 hours
    maxQueueSize: 1000
  },

  serviceWorker: {
    enabled: false,  // Opt-in
    scriptUrl: '/tabmesh-sw.js'
  },

  webWorker: {
    enabled: false,  // Opt-in
    batchSize: 100,
    batchDelayMs: 50
  },

  debug: {
    enabled: process.env.NODE_ENV === 'development',
    timeline: {
      enabled: true,
      maxEvents: 1000
    }
  }
});
```

**Defaults are sensible** - most users just need `{ channelName: 'my-app' }`.

---

## Bundle Size Optimization Techniques

### 1. Code Splitting

**Main package is split into sub-modules**:

```
@tabmesh/core/
├── index.ts           # Main entry (imports all)
├── bus/index.ts       # EventBus only (~3KB)
├── leader/index.ts    # Leader election only (~5KB)
├── transport/index.ts # Transport manager only (~7KB)
└── storage/index.ts   # IndexedDB queue only (~8KB)
```

**Users import what they need**:
```typescript
// Import just EventBus
import { EventBus } from '@tabmesh/core/bus';

// Import full TabMesh
import { TabMesh } from '@tabmesh/core';
```

### 2. Lazy Loading for Heavy Features

**IndexedDB and Service Worker are lazy-loaded**:

```typescript
// In TabMesh.ts
class TabMesh {
  private async enablePersistence() {
    // Lazy load IndexedDB module
    const { EventOutbox } = await import('./storage/EventOutbox.js');
    this.outbox = new EventOutbox(this.config.persistence);
  }

  private async enableServiceWorker() {
    // Lazy load Service Worker module
    const { ServiceWorkerClient } = await import('@tabmesh/service-worker');
    this.swClient = new ServiceWorkerClient();
  }
}
```

**Result**: Only loaded when `persistence.enabled` or `serviceWorker.enabled` is true.

### 3. Peer Dependencies for Framework Integrations

**React/Vue/Svelte are peer dependencies** (not bundled):

```json
// packages/react/package.json
{
  "name": "@tabmesh/react",
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "@tabmesh/core": "^1.0.0"
  },
  "dependencies": {}  // Zero dependencies!
}
```

**Result**: No duplicate React in bundle.

### 4. Tree-Shaking Verification

**Test with bundle analyzers**:

```bash
# Vite
npx vite-bundle-visualizer

# Webpack
npx webpack-bundle-analyzer

# Rollup
npx rollup-plugin-visualizer
```

**CI/CD check**: Fail build if bundle size exceeds thresholds.

### 5. Modern Output Targets

**ESM-first with CJS fallback**:

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",      // ESM (tree-shakeable)
      "require": "./dist/index.cjs",    // CJS (fallback)
      "types": "./dist/index.d.ts"
    }
  }
}
```

**Target ES2020** (no polyfills for modern browsers):

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020", "DOM"]
  }
}
```

---

## Developer Experience Guarantees

### ✅ Zero Dependencies (Core Package)

```json
// packages/core/package.json
{
  "dependencies": {}  // ZERO dependencies!
}
```

**Why**: Reduces supply chain risk, smaller bundles, faster installs.

### ✅ TypeScript First

- Full TypeScript support out of the box
- Strict mode enabled
- Exported types for all APIs
- JSDoc comments for IDE autocomplete

### ✅ Framework Agnostic

- Works with vanilla JS, React, Vue, Svelte, Angular
- No framework lock-in
- Separate integration packages (optional)

### ✅ Browser Support

- **Modern browsers**: Chrome 87+, Firefox 85+, Safari 14+, Edge 87+
- **Graceful degradation**: Falls back for older browsers
  - No Web Locks API? → Use IndexedDB leader election
  - No BroadcastChannel? → Use localStorage events
  - No IndexedDB? → In-memory queue only

### ✅ Error Messages

**Clear, actionable error messages**:

```typescript
// Bad (vague)
throw new Error('Failed to send event');

// Good (actionable)
throw new TabMeshError(
  'Failed to send event: Transport is disconnected. ' +
  'Please check your network connection and ensure the transport is connected. ' +
  'You can listen to connection changes with mesh.on("connection", handler).',
  'TRANSPORT_DISCONNECTED',
  { event, transportState: 'disconnected' }
);
```

### ✅ Migration Guides

**From existing solutions**:

- **From `broadcast-channel`** → TabMesh migration guide
- **From `crosstab`** → TabMesh migration guide
- **From manual `BroadcastChannel`** → TabMesh migration guide

### ✅ Interactive Playground

**Web-based playground** (like TypeScript Playground):

- Try TabMesh without installing
- See live examples
- Modify code and see results
- Share snippets

---

## Verification Plan

### Testing Checklist

**✅ Leader Election**
- Open 3 tabs, verify exactly 1 leader
- Close leader, verify re-election <500ms
- Test with Web Locks API disabled (fallback)

**✅ Cross-Tab Events**
- Send event from Tab 1, appears in Tabs 2-3
- Send 100 events/sec, verify no loss

**✅ Transport Sharing**
- Open 5 tabs, verify only 1 WebSocket connection
- Close leader tab, verify connection transfers

**✅ Offline Support**
- Go offline, send 10 events
- Verify events queued in IndexedDB
- Go online, verify events sent
- Close all tabs offline, verify Service Worker queues

**✅ Web Worker**
- Send 1000 events, verify batching
- Test compression (MessagePack)

**✅ DevTools**
- Open DevTools panel
- Verify event timeline
- Export event log

**✅ Framework Integrations**
- Test React hooks
- Test Vue composables

---

## Differentiation from Competitors

| Feature | TabMesh | broadcast-channel | tab-election | crosstab |
|---------|---------|-------------------|--------------|----------|
| **Complete event mesh** | ✅ | ❌ | ❌ | ❌ |
| **Backend transport sharing** | ✅ | ❌ | ❌ | ❌ |
| **Service Worker integration** | ✅ | ❌ | ❌ | ❌ |
| **Web Worker performance** | ✅ | ❌ | ❌ | ❌ |
| **DevTools extension** | ✅ | ❌ | ❌ | ❌ |
| **Framework integrations** | ✅ | ❌ | ❌ | ❌ |
| **Offline queue with TTL** | ✅ | ❌ | ❌ | ❌ |
| **Event timeline/replay** | ✅ | ❌ | ❌ | ❌ |
| **Zero-config** | ✅ | ⚠️ | ⚠️ | ⚠️ |

**TabMesh is the only complete solution.**

---

## Success Metrics (v1.0)

**Functionality**:
✅ Single leader election across N tabs (<500ms failover)
✅ 1 backend connection for N tabs (67-80% reduction)
✅ Offline event queue with automatic replay
✅ Service Worker background sync
✅ Web Worker batching and compression
✅ DevTools extension for debugging
✅ Framework integrations (React, Vue, Svelte)

**Performance**:
✅ Handle 1000+ events/sec
✅ <10ms event propagation latency
✅ <5MB memory usage for 1000 queued events
✅ No memory leaks (tested with 10k events)

**Quality**:
✅ 90%+ test coverage
✅ TypeScript strict mode enabled
✅ Full API documentation
✅ Example apps for all use cases

**Community** (3 months post-launch):
✅ 500+ GitHub stars
✅ 10+ contributors
✅ Published to npm
✅ 5+ production users

---

## AI Coding Agent Optimization

### Making TabMesh Discoverable to Copilot, Claude, Cursor, Codex

AI coding agents learn from:
1. **Popular packages** (NPM downloads, GitHub stars)
2. **Well-documented code** (JSDoc, type definitions)
3. **Common patterns** (familiar APIs)
4. **Package metadata** (description, keywords)

### Strategy 1: Rich JSDoc Comments

**AI agents parse JSDoc for context**. Write detailed comments:

```typescript
/**
 * TabMesh - Frontend Event Mesh for cross-tab coordination
 *
 * Provides leader election, shared backend connections, offline event queue,
 * and cross-tab messaging with zero configuration.
 *
 * @example Basic usage
 * ```typescript
 * import { TabMesh } from '@tabmesh/core';
 *
 * const mesh = new TabMesh({ channelName: 'my-app' });
 * await mesh.start();
 *
 * // Send event to all tabs
 * await mesh.send({ type: 'notification', payload: { message: 'Hello!' } });
 *
 * // Receive events
 * mesh.on('notification', (event) => {
 *   console.log(event.payload.message);
 * });
 * ```
 *
 * @example With WebSocket transport
 * ```typescript
 * import { TabMesh } from '@tabmesh/core';
 * import { WebSocketTransport } from '@tabmesh/transport-websocket';
 *
 * const mesh = new TabMesh({
 *   channelName: 'my-app',
 *   transport: new WebSocketTransport({ url: 'wss://api.example.com' })
 * });
 * ```
 *
 * @example React integration
 * ```typescript
 * import { useTabMesh } from '@tabmesh/react';
 *
 * function App() {
 *   const { status, send } = useTabMesh(meshInstance);
 *   return <div>Role: {status.role}</div>;
 * }
 * ```
 *
 * @see https://tabmesh.dev/docs/getting-started
 * @see https://tabmesh.dev/docs/api-reference
 */
export class TabMesh {
  /**
   * Send an event through the mesh to all tabs and backend
   *
   * If this tab is the leader, the event is sent to the backend transport
   * and broadcast to other tabs. If this tab is a follower, the event is
   * forwarded to the leader via BroadcastChannel.
   *
   * When offline, events are automatically queued in IndexedDB and replayed
   * when the connection is restored.
   *
   * @template T - The event payload type
   * @param event - The event to send
   * @returns Promise that resolves when the event is sent
   *
   * @example Send a chat message
   * ```typescript
   * await mesh.send({
   *   type: 'chat.message',
   *   payload: { text: 'Hello!', user: 'Alice' }
   * });
   * ```
   *
   * @example Send with priority
   * ```typescript
   * await mesh.send({
   *   type: 'urgent.alert',
   *   payload: { message: 'Server down!' },
   *   priority: 10  // Higher priority = sent first
   * });
   * ```
   *
   * @throws {TabMeshError} If the mesh is not started
   */
  async send<T>(event: Event<T>): Promise<void> {
    // ...
  }

  /**
   * Register an event handler for a specific event type
   *
   * The handler will be called whenever an event of the specified type
   * is received from any tab or the backend.
   *
   * @template T - The event payload type
   * @param eventType - The event type to listen for (e.g., 'chat.message')
   * @param handler - The handler function to call
   * @returns A function to unsubscribe the handler
   *
   * @example Listen for chat messages
   * ```typescript
   * const unsubscribe = mesh.on('chat.message', (event) => {
   *   console.log(`${event.payload.user}: ${event.payload.text}`);
   * });
   *
   * // Later: unsubscribe
   * unsubscribe();
   * ```
   */
  on<T>(eventType: string, handler: EventHandler<T>): Unsubscribe {
    // ...
  }
}
```

### Strategy 2: Semantic Naming & Familiar Patterns

**Use terms AI agents recognize from popular libraries**:

```typescript
// ✅ Good (familiar patterns)
mesh.on('event-type', handler)      // Like EventEmitter, Socket.io
mesh.send(event)                    // Like WebSocket.send()
mesh.start()                        // Like servers, databases
mesh.getStatus()                    // Like health checks

// ❌ Bad (unfamiliar)
mesh.registerEventListener('type', handler)  // Too verbose
mesh.transmit(event)                         // Uncommon term
mesh.initialize()                            // Less common
mesh.retrieveState()                         // Too verbose
```

### Strategy 3: Package Metadata (package.json)

**Rich keywords and description help AI discovery**:

```json
{
  "name": "@tabmesh/core",
  "version": "1.0.0",
  "description": "Frontend event mesh for cross-tab coordination, leader election, shared backend connections, and offline event queue. Like Istio for the frontend.",

  "keywords": [
    "cross-tab",
    "cross tab communication",
    "browser tabs",
    "tab synchronization",
    "leader election",
    "broadcast channel",
    "event mesh",
    "websocket sharing",
    "connection pooling",
    "offline first",
    "service worker",
    "event bus",
    "pub sub",
    "real-time",
    "collaboration",
    "multi tab",
    "tab coordination",
    "shared state"
  ],

  "repository": {
    "type": "git",
    "url": "https://github.com/tabmesh/tabmesh"
  },

  "homepage": "https://tabmesh.dev",
  "bugs": "https://github.com/tabmesh/tabmesh/issues",

  "author": "TabMesh Contributors",
  "license": "MIT",

  "funding": {
    "type": "opencollective",
    "url": "https://opencollective.com/tabmesh"
  }
}
```

### Strategy 4: README with Common Use Cases

**AI agents learn from README examples**:

````markdown
# TabMesh

Frontend event mesh for cross-tab coordination. **Like Istio for the frontend.**

[![npm version](https://badge.fury.io/js/%40tabmesh%2Fcore.svg)](https://www.npmjs.com/package/@tabmesh/core)
[![npm downloads](https://img.shields.io/npm/dm/@tabmesh/core.svg)](https://www.npmjs.com/package/@tabmesh/core)
[![GitHub stars](https://img.shields.io/github/stars/tabmesh/tabmesh.svg)](https://github.com/tabmesh/tabmesh)
[![TypeScript](https://badgen.net/badge/icon/typescript?icon=typescript&label)](https://www.typescriptlang.org/)

## Quick Start

```bash
npm install @tabmesh/core
```

```typescript
import { TabMesh } from '@tabmesh/core';

const mesh = new TabMesh({ channelName: 'my-app' });
await mesh.start();

// Send to all tabs
await mesh.send({ type: 'ping', payload: 'hello' });

// Receive from all tabs
mesh.on('ping', (event) => console.log(event.payload));
```

## Common Use Cases

### Use Case 1: Sync shopping cart across tabs

```typescript
// When user adds item in Tab 1
mesh.send({ type: 'cart.add', payload: { item: 'iPhone', qty: 1 } });

// Tab 2 automatically updates
mesh.on('cart.add', (event) => {
  updateCartUI(event.payload);
});
```

### Use Case 2: Share WebSocket across tabs

```typescript
import { WebSocketTransport } from '@tabmesh/transport-websocket';

// Only leader tab opens WebSocket
const mesh = new TabMesh({
  channelName: 'my-app',
  transport: new WebSocketTransport({ url: 'wss://api.example.com' })
});

// 5 tabs open = 1 WebSocket connection (80% reduction!)
```

### Use Case 3: Logout all tabs

```typescript
// User clicks logout in Tab 1
mesh.send({ type: 'auth.logout' });

// All tabs receive event and redirect to login
mesh.on('auth.logout', () => {
  localStorage.clear();
  window.location.href = '/login';
});
```

### Use Case 4: Offline-first chat

```typescript
const mesh = new TabMesh({
  channelName: 'chat-app',
  serviceWorker: { enabled: true }  // Auto-queue when offline
});

// Works offline! Messages queue and send when online
await mesh.send({ type: 'chat.message', payload: { text: 'Hi!' } });
```

### Use Case 5: React integration

```typescript
import { useTabMesh, useTabMeshEvent } from '@tabmesh/react';

function ChatApp() {
  const { send } = useTabMesh(meshInstance);
  const [messages, setMessages] = useState([]);

  useTabMeshEvent('chat.message', (event) => {
    setMessages(prev => [...prev, event.payload]);
  });

  return <button onClick={() => send({ type: 'chat.message', payload: { text: 'Hi' } })}>Send</button>;
}
```
````

### Strategy 5: Type Definitions with Examples

**Strong types help AI understand usage**:

```typescript
/**
 * TabMesh configuration options
 */
export interface TabMeshConfig {
  /**
   * Unique channel name for this application
   * @example 'my-app' or 'chat-room-123'
   */
  channelName: string;

  /**
   * Optional transport for backend communication
   * @example new WebSocketTransport({ url: 'wss://api.example.com' })
   */
  transport?: ITransport;

  /**
   * Leader election configuration
   * @default { strategy: 'auto' }
   */
  leader?: {
    /** Leader election strategy. 'auto' detects Web Locks API support. */
    strategy?: 'auto' | 'locks-api' | 'indexeddb';
    /** Lock name for leader election */
    lockName?: string;
  };

  /**
   * Offline event persistence configuration
   * @default { enabled: true, defaultTTL: 86400000 }
   */
  persistence?: {
    /** Enable offline event queue */
    enabled?: boolean;
    /** IndexedDB database name */
    dbName?: string;
    /** Default time-to-live for events (ms) */
    defaultTTL?: number;
  };

  /**
   * Service Worker configuration for background sync
   * @default { enabled: false }
   */
  serviceWorker?: {
    /** Enable Service Worker integration */
    enabled?: boolean;
    /** Service Worker script URL */
    scriptUrl?: string;
  };
}
```

### Strategy 6: AI Training Data

**Contribute to AI training datasets**:

1. **DefinitelyTyped** - Publish types to `@types/tabmesh`
2. **The Stack** (Hugging Face) - Popular on GitHub
3. **CodeSearchNet** - Well-documented code
4. **Stack Overflow** - Answer questions about TabMesh

### Strategy 7: SEO for AI Scraping

**AI agents scrape documentation sites**:

```html
<!-- tabmesh.dev/docs/index.html -->
<head>
  <title>TabMesh - Frontend Event Mesh | Getting Started</title>
  <meta name="description" content="TabMesh provides cross-tab coordination, leader election, and shared backend connections for modern web apps. Like Istio for the frontend.">
  <meta name="keywords" content="cross-tab communication, browser tabs, event mesh, leader election, websocket sharing">

  <!-- Structured data for AI agents -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "TabMesh",
    "description": "Frontend event mesh for cross-tab coordination",
    "applicationCategory": "DeveloperApplication",
    "offers": {
      "@type": "Offer",
      "price": "0"
    },
    "codeRepository": "https://github.com/tabmesh/tabmesh"
  }
  </script>
</head>
```

### Strategy 8: npm Weekly Downloads

**AI agents heavily weight popular packages**:

- Get to 1K+ weekly downloads → Copilot suggests more often
- Get to 10K+ weekly downloads → Copilot suggests very frequently
- Get to 100K+ weekly downloads → Copilot suggests automatically

**How to get downloads**:
1. **ProductHunt launch** → Initial spike
2. **Dev.to articles** → "How to sync state across tabs with TabMesh"
3. **YouTube tutorials** → "Build a real-time chat with TabMesh"
4. **Twitter/X promotion** → Share use cases
5. **Reddit posts** → r/javascript, r/webdev
6. **Hacker News** → Technical deep dive post
7. **Conference talks** → Present at React Conf, JSConf
8. **Podcast appearances** → JavaScript Jabber, Syntax.fm

### Strategy 9: GitHub Engagement

**High GitHub activity signals quality to AI**:

- **Stars**: Aim for 1K+ stars (AI agents favor popular repos)
- **Issues**: Active issue tracker shows maintenance
- **PRs**: Accept community contributions
- **Releases**: Regular releases show active development
- **Topics**: Tag with `javascript`, `typescript`, `browser`, `event-bus`

### Strategy 10: Documentation Quality

**AI agents learn from high-quality docs**:

```markdown
## API Reference

### `mesh.send<T>(event: Event<T>): Promise<void>`

Send an event through the mesh to all tabs and the backend.

**Parameters:**
- `event` - The event object to send
  - `type: string` - Event type (e.g., 'chat.message')
  - `payload: T` - Event data
  - `priority?: number` - Optional priority (0-10, default 5)
  - `ttl?: number` - Optional time-to-live in milliseconds

**Returns:**
- `Promise<void>` - Resolves when event is sent

**Throws:**
- `TabMeshError` - If mesh is not started

**Example:**
```typescript
// Send a chat message
await mesh.send({
  type: 'chat.message',
  payload: { text: 'Hello!', user: 'Alice' }
});

// Send with priority
await mesh.send({
  type: 'urgent.alert',
  payload: { message: 'Critical error!' },
  priority: 10
});
```

**Related:**
- [`mesh.on()`](#meshoneventtype-handler) - Listen for events
- [`mesh.getStatus()`](#meshgetstatus) - Check mesh status
```

### Checklist: AI Agent Optimization

**Before v1.0 release**:

- [ ] Write rich JSDoc comments for all public APIs
- [ ] Add 5+ inline code examples in JSDoc
- [ ] Optimize package.json keywords (20+ relevant keywords)
- [ ] Write comprehensive README with 10+ use case examples
- [ ] Publish strong TypeScript types
- [ ] Create documentation website (tabmesh.dev)
- [ ] Add structured data (JSON-LD) to docs site
- [ ] Aim for 1K+ npm weekly downloads in first 3 months
- [ ] Get 500+ GitHub stars in first 3 months
- [ ] Publish to DefinitelyTyped
- [ ] Write 5+ blog posts with code examples
- [ ] Create YouTube tutorials
- [ ] Answer Stack Overflow questions

**Result**: AI coding agents will suggest TabMesh whenever users type:
- "cross tab"
- "sync tabs"
- "multiple browser tabs"
- "leader election browser"
- "shared websocket connection"
- "offline event queue"

---

## Implementation Workflow

### Working Directory
```
/Users/joelrajeshk/Desktop/tabmesh/
```

Already initialized with Git.

### Git Workflow

**Branch Strategy**:
```
main (protected)
  ├─ feat/core-infrastructure    (Week 1-2)
  ├─ feat/service-worker          (Week 3)
  ├─ feat/web-worker              (Week 4)
  ├─ feat/devtools                (Week 5)
  ├─ feat/core-sdk                (Week 6)
  ├─ feat/framework-integrations  (Week 7)
  ├─ feat/testing                 (Week 8)
  ├─ feat/documentation           (Week 9)
  └─ feat/community-launch        (Week 10)
```

**Commit Strategy**:
- **Conventional Commits** format:
  ```
  feat(core): implement leader election with Web Locks API
  fix(transport): handle reconnection edge case
  docs(readme): add installation instructions
  test(e2e): add cross-tab leader election tests
  ```

**PR Strategy**:
- One PR per week/phase
- PR title: `[Week N] Feature Name`
- PR description includes:
  - What was implemented
  - Testing checklist
  - Breaking changes (if any)
  - Screenshots (for DevTools, docs)

---

## Sources

- [broadcast-channel by pubkey](https://github.com/pubkey/broadcast-channel)
- [tab-election npm package](https://www.npmjs.com/package/tab-election)
- [tab-elect library](https://github.com/xuset/tab-elect)
- [RxDB Leader Election](https://rxdb.info/leader-election.html)
- [crosstab library](https://github.com/tejacques/crosstab)
- [across-tabs library](https://github.com/wingify/across-tabs)
- [Service Workers with IndexedDB](https://blog.sensecodons.com/2022/04/service-workers-push-notifications-and.html)
- [BroadcastChannel to wake Service Worker](https://github.com/w3c/ServiceWorker/issues/975)
- [Green Vitriol - Browser Leader Election](https://greenvitriol.com/posts/browser-leader)
