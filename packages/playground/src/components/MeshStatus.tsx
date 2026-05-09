import { useTabMesh, useTabMeshEvent } from '@tabmesh/react';
import { useCallback, useState } from 'react';
import { mesh } from '../mesh';

export function MeshStatus() {
  const { status } = useTabMesh();
  const [loggedOut, setLoggedOut] = useState(false);

  // Listen for broadcast logout (Feature 2)
  useTabMeshEvent(
    'auth.logout',
    useCallback(() => {
      setLoggedOut(true);
    }, [])
  );

  const handleClearAndLogout = async () => {
    // CONTEXT.md logout sequence: clearOutbox → disconnectTransport →
    // broadcast(auth.logout) → stop. Order matters: dropping the transport
    // before the broadcast prevents the soon-to-be-stale token from racing
    // any final outbound events.
    await mesh.clearOutbox();
    await mesh.disconnectTransport();
    mesh.broadcast({ type: 'auth.logout', payload: {} });
    await mesh.stop();
  };

  if (loggedOut) {
    return (
      <section className="panel">
        <h2>Mesh Status</h2>
        <div className="logged-out">Logged out from all tabs. Refresh to restart.</div>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Mesh Status</h2>
      <table className="status-table">
        <tbody>
          <tr>
            <td>Started</td>
            <td>{status.started ? 'Yes' : 'No'}</td>
          </tr>
          <tr>
            <td>Hub Mode</td>
            <td>{status.hubMode ?? 'none'}</td>
          </tr>
          <tr>
            <td>Hub Connected</td>
            <td>{status.hubConnected ? 'Yes' : 'No'}</td>
          </tr>
          <tr>
            <td>Role</td>
            <td>{status.role ?? 'n/a'}</td>
          </tr>
          <tr>
            <td>Transport</td>
            <td>{status.transportState}</td>
          </tr>
          <tr>
            <td>Tab ID</td>
            <td className="mono" title={status.tabId}>
              {status.tabId.slice(0, 12)}...
            </td>
          </tr>
          <tr>
            <td>Degraded</td>
            <td>{status.degraded ? 'Yes' : 'No'}</td>
          </tr>
        </tbody>
      </table>
      <div className="status-actions">
        <button type="button" className="btn btn-danger" onClick={handleClearAndLogout}>
          Clear Outbox & Logout All
        </button>
      </div>
    </section>
  );
}
