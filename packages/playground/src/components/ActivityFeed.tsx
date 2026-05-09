import type { TabMeshEvent } from '@tabmesh/core';
import { useTabMeshEvent } from '@tabmesh/react';
import { useCallback, useRef, useState } from 'react';
import type { ActivityEntry } from '../types';

const MAX_ENTRIES = 50;

const SYSTEM_EVENTS = new Set([
  'hub.connected',
  'hub.disconnected',
  'transport.connected',
  'transport.disconnected',
  'transport.reconnecting',
  'transport.error',
  'event.delivery.failed',
  'storage.degraded',
]);

export function ActivityFeed() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const counterRef = useRef(0);

  // Wildcard subscription — captures every event (Feature 13)
  useTabMeshEvent(
    '*',
    useCallback((event: TabMeshEvent) => {
      const entry: ActivityEntry = {
        id: `activity-${counterRef.current++}`,
        type: event.type,
        source: event.source,
        sourceTabId: event.meta.sourceTabId,
        timestamp: event.meta.createdAt,
        payload: event.payload,
      };
      setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
    }, [])
  );

  return (
    <section className="panel activity-panel">
      <h2>Activity Feed</h2>
      <div className="activity-list">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`activity-entry ${SYSTEM_EVENTS.has(entry.type) ? 'system-event' : ''}`}
          >
            <span className={`source-badge ${entry.source}`}>{entry.source.toUpperCase()}</span>
            <span className="activity-type">{entry.type}</span>
            <span className="activity-tab" title={entry.sourceTabId}>
              {entry.sourceTabId.slice(0, 8)}
            </span>
            <span className="activity-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          </div>
        ))}
        {entries.length === 0 && <div className="activity-empty">No events yet.</div>}
      </div>
    </section>
  );
}
