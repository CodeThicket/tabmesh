import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { mesh } from './mesh';
import './styles/app.css';

// Pre-start buffering demo (Feature 10):
// Send an event BEFORE mesh.start() — it will be delivered after start.
mesh.send({
  type: 'todo.add',
  payload: {
    id: `buffered-${mesh.getStatus().tabId}`,
    text: 'Buffered before start()',
    createdBy: mesh.getStatus().tabId,
    urgent: false,
    createdAt: Date.now(),
  },
});

// Start the mesh
mesh.start().catch((err) => {
  console.error('[TabMesh] Failed to start:', err);
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
