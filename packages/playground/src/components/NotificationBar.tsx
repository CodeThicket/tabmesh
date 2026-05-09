import type { TabMeshEvent } from '@tabmesh/core';
import { useTabMeshEvent } from '@tabmesh/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationPayload } from '../types';

interface Notification {
  id: string;
  message: string;
  expiresAt: number;
}

export function NotificationBar() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const counterRef = useRef(0);

  // Listen for TTL notifications (Feature 7)
  useTabMeshEvent<NotificationPayload>(
    'notification',
    useCallback((event: TabMeshEvent<NotificationPayload>) => {
      const notif: Notification = {
        id: `notif-${counterRef.current++}`,
        message: event.payload.message,
        expiresAt: Date.now() + 5000,
      };
      setNotifications((prev) => [...prev, notif]);
    }, [])
  );

  // Auto-remove expired notifications
  useEffect(() => {
    if (notifications.length === 0) return;

    const timer = setInterval(() => {
      const now = Date.now();
      setNotifications((prev) => prev.filter((n) => n.expiresAt > now));
    }, 500);

    return () => clearInterval(timer);
  }, [notifications.length]);

  if (notifications.length === 0) return null;

  return (
    <div className="notification-bar">
      {notifications.map((notif) => (
        <div key={notif.id} className="notification">
          {notif.message}
        </div>
      ))}
    </div>
  );
}
