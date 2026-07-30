import { useStore } from 'zustand';

import {
  notificationStore,
  type NotificationStore,
} from './notification-store';
import type { AppNotification } from './notification';
import { NotificationToast } from './NotificationToast';

interface NotificationHostProps {
  readonly store?: NotificationStore;
}

interface NotificationStackProps {
  readonly notifications: readonly AppNotification[];
  readonly store: NotificationStore;
}

export function NotificationStack({
  notifications,
  store,
}: NotificationStackProps) {
  if (notifications.length === 0) {
    return null;
  }

  return (
    <aside
      aria-label="应用通知"
      className="pointer-events-none fixed right-4 top-4 z-[100] flex max-h-[calc(100vh-32px)] flex-col gap-2.5 overflow-y-auto"
    >
      {notifications.slice(0, 3).map((notification) => (
        <NotificationToast
          key={notification.id}
          notification={notification}
          onDismiss={() => store.getState().dismiss(notification.id)}
          onPause={() => store.getState().pause(notification.id)}
          onResume={() => store.getState().resume(notification.id)}
          onInvokeAction={() =>
            store.getState().invokeAction(notification.id)
          }
        />
      ))}
    </aside>
  );
}

export function NotificationHost({
  store = notificationStore,
}: NotificationHostProps) {
  const notifications = useStore(store, (state) =>
    state.notifications.slice(0, 3),
  );

  return <NotificationStack notifications={notifications} store={store} />;
}
