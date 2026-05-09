import { TabMeshProvider } from '@tabmesh/react';
import { ActivityFeed } from './components/ActivityFeed';
import { Header } from './components/Header';
import { MeshStatus } from './components/MeshStatus';
import { NotificationBar } from './components/NotificationBar';
import { TodoList } from './components/TodoList';
import { mesh } from './mesh';

export function App() {
  return (
    <TabMeshProvider mesh={mesh}>
      <div className="app">
        <Header />
        <NotificationBar />
        <div className="main-content">
          <div className="left-panel">
            <TodoList />
          </div>
          <div className="right-panel">
            <MeshStatus />
            <ActivityFeed />
          </div>
        </div>
      </div>
    </TabMeshProvider>
  );
}
