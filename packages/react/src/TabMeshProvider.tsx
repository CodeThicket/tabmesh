import type { TabMesh } from '@tabmesh/core';
import { type ReactNode, createContext } from 'react';

/**
 * React context for providing a TabMesh instance to the component tree.
 *
 * This is an escape hatch for testing, Storybook, or multi-app-per-page
 * scenarios. The documented default is direct instance passing.
 */
export const TabMeshContext = createContext<TabMesh | null>(null);

/** Props for TabMeshProvider. */
export interface TabMeshProviderProps {
  mesh: TabMesh;
  children: ReactNode;
}

/**
 * Provides a TabMesh instance to the component tree via React context.
 *
 * @example
 * ```tsx
 * <TabMeshProvider mesh={meshInstance}>
 *   <App />
 * </TabMeshProvider>
 * ```
 */
export function TabMeshProvider({ mesh, children }: TabMeshProviderProps) {
  return <TabMeshContext.Provider value={mesh}>{children}</TabMeshContext.Provider>;
}
