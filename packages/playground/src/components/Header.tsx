import { useTabMesh } from '@tabmesh/react';

export function Header() {
  const { status } = useTabMesh();
  const shortId = status.tabId.slice(0, 8);

  return (
    <header className="header">
      <h1>TabMesh Playground</h1>
      <div className="header-status">
        <span className="badge badge-tab" title={status.tabId}>
          Tab: {shortId}
        </span>
        <span className={`badge ${status.hubConnected ? 'badge-ok' : 'badge-warn'}`}>
          Hub: {status.hubMode ?? 'none'}
        </span>
        <span className="badge">Role: {status.role ?? 'n/a'}</span>
        <span
          className={`badge ${status.transportState === 'connected' ? 'badge-ok' : 'badge-dim'}`}
        >
          Transport: {status.transportState}
        </span>
        {status.degraded && <span className="badge badge-error">Degraded</span>}
      </div>
    </header>
  );
}
