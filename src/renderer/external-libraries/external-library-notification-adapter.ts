import type { ExternalLibrarySnapshot } from '../../shared/external-libraries';
import type { NotificationStore } from '../notifications/notification-store';
import type { SettingsTarget } from '../settings/settings-target';
import type { ExternalLibraryTransition } from './external-library-store';

export interface ExternalLibraryNotificationAdapterDependencies {
  readonly notifications: NotificationStore;
  readonly openSettings: (target: SettingsTarget) => void;
}

const installationActiveStatuses = new Set<
  ExternalLibrarySnapshot['status']
>(['downloading', 'verifying', 'installing']);

function successDedupeKey(libraryId: string): string {
  return `external-library:${libraryId}:install-success`;
}

function failureDedupeKey(libraryId: string): string {
  return `external-library:${libraryId}:install-failed`;
}

function dismissByDedupeKey(
  notifications: NotificationStore,
  dedupeKey: string,
): void {
  const notification = notifications
    .getState()
    .notifications.find(
      (candidate) => candidate.dedupeKey === dedupeKey,
    );

  if (notification) {
    notifications.getState().dismiss(notification.id);
  }
}

function failureMessage(snapshot: ExternalLibrarySnapshot): string {
  if (snapshot.status === 'invalid') {
    return '安装内容未通过完整性检查，请打开设置清理后重试。';
  }

  return '后台安装未能完成，请打开设置查看状态并重试。';
}

export function handleExternalLibraryNotification(
  transition: ExternalLibraryTransition,
  dependencies: ExternalLibraryNotificationAdapterDependencies,
): void {
  if (transition.source === 'initial' || !transition.previous) {
    return;
  }

  const { previous, next } = transition;
  const wasInstalling = installationActiveStatuses.has(previous.status);
  const startedInstalling =
    !installationActiveStatuses.has(previous.status) &&
    installationActiveStatuses.has(next.status);

  if (startedInstalling) {
    dismissByDedupeKey(
      dependencies.notifications,
      failureDedupeKey(next.id),
    );
    return;
  }

  if (!wasInstalling) {
    return;
  }

  if (next.status === 'available') {
    dismissByDedupeKey(
      dependencies.notifications,
      failureDedupeKey(next.id),
    );
    dependencies.notifications.getState().push({
      dedupeKey: successDedupeKey(next.id),
      kind: 'success',
      title: `${next.displayName} 已安装`,
      message: '组件已经可以使用。',
      durationMs: 5_000,
    });
    return;
  }

  if (next.status === 'failed' || next.status === 'invalid') {
    dependencies.notifications.getState().push({
      dedupeKey: failureDedupeKey(next.id),
      kind: 'error',
      title: `${next.displayName} 安装失败`,
      message: failureMessage(next),
      durationMs: null,
      action: {
        label: '查看详情',
        invoke: () =>
          dependencies.openSettings({
            section: 'external-libraries',
            libraryId: next.id,
          }),
      },
    });
  }
}
