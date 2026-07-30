import {
  notificationStore,
  type NotificationStore,
} from '../notifications/notification-store';

export type SetupReadFailureKind =
  | 'app-onboarding'
  | 'agent-provider';

export interface SetupReadFailureDependencies {
  readonly notifications: NotificationStore;
  readonly logger: Pick<Console, 'warn'>;
}

const notificationContent: Record<
  SetupReadFailureKind,
  {
    readonly dedupeKey: string;
    readonly title: string;
    readonly message: string;
  }
> = {
  'app-onboarding': {
    dedupeKey: 'setup-read-failure:app-onboarding',
    title: '首次设置暂时不可用',
    message: '已跳过本次引导，不影响现有 Project。重启后会再次检查。',
  },
  'agent-provider': {
    dedupeKey: 'setup-read-failure:agent-provider',
    title: 'AI Provider 状态暂时不可用',
    message: '不影响资料功能，可稍后在“设置 → AI Provider”中重试。',
  },
};

export function notifySetupReadFailure(
  kind: SetupReadFailureKind,
  error: unknown,
  dependencies: Partial<SetupReadFailureDependencies> = {},
): void {
  const resolved = {
    notifications: dependencies.notifications ?? notificationStore,
    logger: dependencies.logger ?? console,
  };
  const content = notificationContent[kind];

  resolved.logger.warn(content.title, error);
  resolved.notifications.getState().push({
    dedupeKey: content.dedupeKey,
    kind: 'warning',
    title: content.title,
    message: content.message,
    durationMs: 8_000,
  });
}
