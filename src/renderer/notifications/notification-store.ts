import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  createAppNotification,
  type AppNotification,
  type AppNotificationInput,
} from './notification';

export interface NotificationStoreState {
  readonly notifications: readonly AppNotification[];
  push(input: AppNotificationInput): string;
  dismiss(notificationId: string): void;
  pause(notificationId: string): void;
  resume(notificationId: string): void;
  invokeAction(notificationId: string): void;
  clear(): void;
}

export type NotificationStore = StoreApi<NotificationStoreState>;

interface NotificationTiming {
  remainingMs: number;
  hovered: boolean;
  startedTime?: number;
  timer?: ReturnType<typeof setTimeout>;
}

export interface NotificationStoreDependencies {
  readonly createId: () => string;
  readonly now: () => number;
  readonly schedule: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  readonly cancelSchedule: (timer: ReturnType<typeof setTimeout>) => void;
  readonly maxVisible: number;
  readonly logger: Pick<Console, 'warn'>;
}

const defaultDependencies: NotificationStoreDependencies = {
  createId: () => crypto.randomUUID(),
  now: () => Date.now(),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancelSchedule: (timer) => clearTimeout(timer),
  maxVisible: 3,
  logger: console,
};

function requireNotificationId(notificationId: string): string {
  const normalized = notificationId.trim();

  if (normalized.length === 0) {
    throw new Error('Notification ID 不能为空');
  }

  return normalized;
}

export function createNotificationStore(
  dependencies: Partial<NotificationStoreDependencies> = {},
): NotificationStore {
  const resolved = { ...defaultDependencies, ...dependencies };

  if (
    !Number.isSafeInteger(resolved.maxVisible) ||
    resolved.maxVisible <= 0
  ) {
    throw new Error('Notification maxVisible 必须是正整数');
  }

  const timings = new Map<string, NotificationTiming>();

  const stopTimer = (timing: NotificationTiming) => {
    if (timing.timer === undefined) {
      return;
    }

    resolved.cancelSchedule(timing.timer);
    timing.timer = undefined;

    if (timing.startedTime !== undefined) {
      timing.remainingMs = Math.max(
        0,
        timing.remainingMs - (resolved.now() - timing.startedTime),
      );
      timing.startedTime = undefined;
    }
  };

  const syncTimers = () => {
    const notifications = store.getState().notifications;
    const visibleIds = new Set(
      notifications
        .slice(0, resolved.maxVisible)
        .map(({ id }) => id),
    );

    for (const notification of notifications) {
      const timing = timings.get(notification.id);

      if (!timing) {
        continue;
      }
      if (!visibleIds.has(notification.id) || timing.hovered) {
        stopTimer(timing);
        continue;
      }
      if (timing.timer !== undefined) {
        continue;
      }
      if (timing.remainingMs <= 0) {
        store.getState().dismiss(notification.id);
        continue;
      }

      timing.startedTime = resolved.now();
      timing.timer = resolved.schedule(() => {
        timing.timer = undefined;
        timing.startedTime = undefined;
        timing.remainingMs = 0;
        store.getState().dismiss(notification.id);
      }, timing.remainingMs);
    }
  };

  const removeTiming = (notificationId: string) => {
    const timing = timings.get(notificationId);

    if (timing) {
      stopTimer(timing);
      timings.delete(notificationId);
    }
  };

  const store = createStore<NotificationStoreState>((set, get) => ({
    notifications: Object.freeze([]),

    push(input) {
      const current = get().notifications;
      const duplicateIndex = input.dedupeKey
        ? current.findIndex(
            ({ dedupeKey }) => dedupeKey === input.dedupeKey?.trim(),
          )
        : -1;
      const duplicate =
        duplicateIndex < 0 ? undefined : current[duplicateIndex];
      const notification = createAppNotification(
        {
          ...input,
          ...(duplicate ? { id: duplicate.id } : {}),
        },
        resolved.createId(),
      );
      const next =
        duplicateIndex < 0
          ? [...current, notification]
          : current.map((candidate, index) =>
              index === duplicateIndex ? notification : candidate,
            );

      if (duplicate) {
        removeTiming(duplicate.id);
      }
      if (notification.durationMs !== null) {
        timings.set(notification.id, {
          remainingMs: notification.durationMs,
          hovered: false,
        });
      }

      set({ notifications: Object.freeze(next) });
      syncTimers();
      return notification.id;
    },

    dismiss(notificationId) {
      const id = requireNotificationId(notificationId);
      const current = get().notifications;

      if (!current.some((notification) => notification.id === id)) {
        return;
      }

      removeTiming(id);
      set({
        notifications: Object.freeze(
          current.filter((notification) => notification.id !== id),
        ),
      });
      syncTimers();
    },

    pause(notificationId) {
      const timing = timings.get(requireNotificationId(notificationId));

      if (!timing) {
        return;
      }

      timing.hovered = true;
      stopTimer(timing);
    },

    resume(notificationId) {
      const timing = timings.get(requireNotificationId(notificationId));

      if (!timing) {
        return;
      }

      timing.hovered = false;
      syncTimers();
    },

    invokeAction(notificationId) {
      const id = requireNotificationId(notificationId);
      const action = get().notifications.find(
        (notification) => notification.id === id,
      )?.action;

      if (!action) {
        return;
      }

      get().dismiss(id);

      try {
        action.invoke();
      } catch (error) {
        resolved.logger.warn('Notification Action 执行失败', error);
      }
    },

    clear() {
      for (const notificationId of timings.keys()) {
        removeTiming(notificationId);
      }

      set({ notifications: Object.freeze([]) });
    },
  }));

  return store;
}

export const notificationStore = createNotificationStore();
