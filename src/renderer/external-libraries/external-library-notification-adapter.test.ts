import { describe, expect, it, vi } from 'vitest';

import type { ExternalLibrarySnapshot } from '../../shared/external-libraries';
import { createNotificationStore } from '../notifications/notification-store';
import type { ExternalLibraryTransition } from './external-library-store';
import { handleExternalLibraryNotification } from './external-library-notification-adapter';

function createSnapshot(
  status: ExternalLibrarySnapshot['status'],
): ExternalLibrarySnapshot {
  return {
    id: 'libreoffice',
    displayName: 'LibreOffice',
    version: '26.2.5',
    expectedSize: 300_000_000,
    rootPath: '/Users/student/Documents/Learning Companion/externalLib',
    status,
  };
}

function createHarness() {
  let nextId = 0;
  const notifications = createNotificationStore({
    createId: () => `notification-${++nextId}`,
  });
  const openSettings = vi.fn();

  return {
    notifications,
    openSettings,
    handle(
      previous: ExternalLibrarySnapshot | undefined,
      next: ExternalLibrarySnapshot,
      source: ExternalLibraryTransition['source'] = 'event',
    ) {
      handleExternalLibraryNotification(
        {
          ...(previous ? { previous } : {}),
          next,
          source,
        },
        { notifications, openSettings },
      );
    },
  };
}

describe('ExternalLibraryNotificationAdapter', () => {
  it('notifies once when a background installation becomes available', () => {
    const harness = createHarness();

    harness.handle(
      createSnapshot('installing'),
      createSnapshot('available'),
    );
    harness.handle(
      createSnapshot('available'),
      createSnapshot('available'),
    );

    expect(harness.notifications.getState().notifications).toMatchObject([
      {
        kind: 'success',
        title: 'LibreOffice 已安装',
        durationMs: 5_000,
      },
    ]);
  });

  it('does not notify for initial discovery, refreshes or cancellation', () => {
    const harness = createHarness();

    harness.handle(
      createSnapshot('discovering'),
      createSnapshot('available'),
      'initial',
    );
    harness.handle(
      createSnapshot('available'),
      createSnapshot('available'),
    );
    harness.handle(
      createSnapshot('downloading'),
      createSnapshot('not-installed'),
    );

    expect(harness.notifications.getState().notifications).toHaveLength(0);
  });

  it('keeps failures persistent and opens the matching settings target', () => {
    const harness = createHarness();

    harness.handle(
      createSnapshot('verifying'),
      {
        ...createSnapshot('failed'),
        errorCode: 'EXTERNAL_LIBRARY_INSTALL_FAILED',
      },
    );

    const [notification] =
      harness.notifications.getState().notifications;
    expect(notification).toMatchObject({
      kind: 'error',
      title: 'LibreOffice 安装失败',
      durationMs: null,
      action: { label: '查看详情' },
    });

    harness.notifications
      .getState()
      .invokeAction(notification!.id);

    expect(harness.openSettings).toHaveBeenCalledWith({
      section: 'external-libraries',
      libraryId: 'libreoffice',
    });
  });

  it('clears an old failure when a retry starts', () => {
    const harness = createHarness();
    harness.handle(
      createSnapshot('installing'),
      createSnapshot('failed'),
    );
    expect(harness.notifications.getState().notifications).toHaveLength(1);

    harness.handle(
      createSnapshot('failed'),
      createSnapshot('downloading'),
      'operation',
    );

    expect(harness.notifications.getState().notifications).toHaveLength(0);
  });
});
