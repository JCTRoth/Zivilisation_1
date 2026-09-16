import React from 'react';
import type { Notification } from '../../../types/game';
import { HUMAN_PLAYER_ID } from '../../utils/PlayerConstants';

const ICONS: Record<Notification['type'], string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '⛔',
};

interface NotificationCenterProps {
  notifications: Notification[];
  onDismiss: (id: number) => void;
}

/**
 * Renders the store's notification queue as a stack of dismissible toasts.
 * Purely presentational — the caller owns the store wiring.
 *
 * Only toasts related to the (human) player are shown: notifications that are
 * explicitly tagged for another civilization (AI-only events) are hidden.
 */
const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  onDismiss,
}) => {
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return null;
  }

  const visible = notifications.filter(
    (n) => n.civId === undefined || n.civId === HUMAN_PLAYER_ID,
  );
  if (visible.length === 0) return null;

  return (
    <div className="notification-center" role="status" aria-live="polite">
      {visible.map((notification) => (
        <div
          key={notification.id}
          className={`notification-item notification-item--${notification.type}`}
          role="button"
          tabIndex={0}
          title="Dismiss"
          onClick={() => onDismiss(notification.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onDismiss(notification.id);
            }
          }}
        >
          <span className="notification-item__icon" aria-hidden="true">
            {ICONS[notification.type] ?? ICONS.info}
          </span>
          <span className="notification-item__message">
            {notification.message}
          </span>
        </div>
      ))}
    </div>
  );
};

export default NotificationCenter;
