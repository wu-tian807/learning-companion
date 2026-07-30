import { describe, expect, it, vi } from 'vitest';

import { createNotificationStore } from '../notifications/notification-store';
import { notifySetupReadFailure } from './setup-read-failure-notification';

function createDependencies() {
  return {
    notifications: createNotificationStore({
      createId: () => 'notification-1',
      schedule: vi.fn(() => 1 as never),
      cancelSchedule: vi.fn(),
    }),
    logger: { warn: vi.fn() },
  };
}

describe('notifySetupReadFailure', () => {
  it('reports onboarding failures without requiring a blocking retry', () => {
    const dependencies = createDependencies();
    const error = new Error('IPC unavailable');

    notifySetupReadFailure(
      'app-onboarding',
      error,
      dependencies,
    );

    expect(dependencies.notifications.getState().notifications).toEqual([
      expect.objectContaining({
        kind: 'warning',
        title: '首次设置暂时不可用',
        message:
          '已跳过本次引导，不影响现有 Project。重启后会再次检查。',
        durationMs: 8_000,
      }),
    ]);
    expect(dependencies.logger.warn).toHaveBeenCalledWith(
      '首次设置暂时不可用',
      error,
    );
  });

  it('points Provider failures to the settings tab', () => {
    const dependencies = createDependencies();

    notifySetupReadFailure(
      'agent-provider',
      new Error('runtime unavailable'),
      dependencies,
    );

    expect(
      dependencies.notifications.getState().notifications[0],
    ).toMatchObject({
      title: 'AI Provider 状态暂时不可用',
      message:
        '不影响资料功能，可稍后在“设置 → AI Provider”中重试。',
    });
  });
});
