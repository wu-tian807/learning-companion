import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNotificationStore } from './notification-store';

function createHarness(maxVisible = 3) {
  let nextId = 0;
  const warn = vi.fn();
  const store = createNotificationStore({
    createId: () => `notification-${++nextId}`,
    maxVisible,
    logger: { warn },
  });

  return { store, warn };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('NotificationStore', () => {
  it('auto-dismisses visible notifications and waits before timing queued ones', () => {
    vi.useFakeTimers();
    const { store } = createHarness(3);

    for (let index = 1; index <= 4; index += 1) {
      store.getState().push({
        kind: 'success',
        title: `完成 ${index}`,
        durationMs: 1_000,
      });
    }

    expect(store.getState().notifications).toHaveLength(4);
    vi.advanceTimersByTime(1_000);
    expect(store.getState().notifications.map(({ title }) => title)).toEqual([
      '完成 4',
    ]);
    vi.advanceTimersByTime(999);
    expect(store.getState().notifications).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(store.getState().notifications).toHaveLength(0);
  });

  it('pauses and resumes the remaining auto-dismiss duration', () => {
    vi.useFakeTimers();
    const { store } = createHarness();
    const id = store.getState().push({
      kind: 'info',
      title: '后台处理中',
      durationMs: 5_000,
    });

    vi.advanceTimersByTime(2_000);
    store.getState().pause(id);
    vi.advanceTimersByTime(10_000);
    expect(store.getState().notifications).toHaveLength(1);

    store.getState().resume(id);
    vi.advanceTimersByTime(2_999);
    expect(store.getState().notifications).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(store.getState().notifications).toHaveLength(0);
  });

  it('replaces duplicate notifications and resets their duration', () => {
    vi.useFakeTimers();
    const { store } = createHarness();
    const firstId = store.getState().push({
      dedupeKey: 'external-library:libreoffice',
      kind: 'error',
      title: '安装失败',
    });
    const secondId = store.getState().push({
      dedupeKey: 'external-library:libreoffice',
      kind: 'success',
      title: '安装完成',
      durationMs: 1_000,
    });

    expect(secondId).toBe(firstId);
    expect(store.getState().notifications).toMatchObject([
      {
        id: firstId,
        title: '安装完成',
        kind: 'success',
      },
    ]);
    vi.advanceTimersByTime(1_000);
    expect(store.getState().notifications).toHaveLength(0);
  });

  it('keeps errors persistent and invokes an action at most once', () => {
    vi.useFakeTimers();
    const { store } = createHarness();
    const invoke = vi.fn();
    const id = store.getState().push({
      kind: 'error',
      title: '安装失败',
      action: {
        label: '查看详情',
        invoke,
      },
    });

    vi.advanceTimersByTime(60_000);
    expect(store.getState().notifications).toHaveLength(1);

    store.getState().invokeAction(id);
    store.getState().invokeAction(id);

    expect(invoke).toHaveBeenCalledOnce();
    expect(store.getState().notifications).toHaveLength(0);
  });

  it('contains action errors without breaking the notification store', () => {
    const { store, warn } = createHarness();
    const id = store.getState().push({
      kind: 'warning',
      title: '需要处理',
      durationMs: null,
      action: {
        label: '处理',
        invoke: () => {
          throw new Error('action failed');
        },
      },
    });

    expect(() => store.getState().invokeAction(id)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(store.getState().notifications).toHaveLength(0);
  });

  it('rejects invalid notification data and clears active timers', () => {
    vi.useFakeTimers();
    const { store } = createHarness();

    expect(() =>
      store.getState().push({
        kind: 'info',
        title: '   ',
      }),
    ).toThrow('Notification title 不能为空');
    store.getState().push({
      kind: 'success',
      title: '完成',
    });
    store.getState().clear();
    vi.runAllTimers();

    expect(store.getState().notifications).toHaveLength(0);
  });
});
