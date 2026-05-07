/**
 * @tabmesh/react — React hooks for TabMesh.
 *
 * Provides `useTabMesh`, `useTabMeshEvent`, and `TabMeshProvider`
 * for integrating TabMesh into React applications.
 *
 * @example Direct instance usage (recommended for singleton)
 * ```tsx
 * import { useTabMesh, useTabMeshEvent } from '@tabmesh/react';
 *
 * function ChatApp() {
 *   const { status, send } = useTabMesh(meshInstance);
 *   const [messages, setMessages] = useState([]);
 *
 *   useTabMeshEvent(meshInstance, 'chat.message', (event) => {
 *     setMessages(prev => [...prev, event.payload]);
 *   });
 *
 *   return <button onClick={() => send({ type: 'chat.message', payload: { text: 'Hi' } })}>Send</button>;
 * }
 * ```
 *
 * @example Context usage (for testing/Storybook)
 * ```tsx
 * import { TabMeshProvider, useTabMesh } from '@tabmesh/react';
 *
 * function App() {
 *   return (
 *     <TabMeshProvider mesh={meshInstance}>
 *       <ChatApp />
 *     </TabMeshProvider>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 */

export { TabMeshContext, TabMeshProvider } from './TabMeshProvider.js';
export { useTabMesh } from './useTabMesh.js';
export { useTabMeshEvent } from './useTabMeshEvent.js';
