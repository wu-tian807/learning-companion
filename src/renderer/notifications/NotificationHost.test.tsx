import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NotificationStack } from './NotificationHost';
import { createNotificationStore } from './notification-store';

describe('NotificationHost', () => {
  it('renders at most three accessible notifications', () => {
    let nextId = 0;
    const store = createNotificationStore({
      createId: () => `notification-${++nextId}`,
    });

    for (let index = 1; index <= 4; index += 1) {
      store.getState().push({
        kind: 'error',
        title: `错误 ${index}`,
      });
    }

    const markup = renderToStaticMarkup(
      <NotificationStack
        notifications={store.getState().notifications}
        store={store}
      />,
    );

    expect(markup).toContain('aria-label="应用通知"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('错误 1');
    expect(markup).toContain('错误 2');
    expect(markup).toContain('错误 3');
    expect(markup).not.toContain('错误 4');
  });

  it('renders optional details and action without exposing domain concepts', () => {
    const store = createNotificationStore({
      createId: () => 'notification',
    });
    store.getState().push({
      kind: 'success',
      title: '处理完成',
      message: '现在可以继续使用。',
      durationMs: null,
      action: {
        label: '打开',
        invoke: () => undefined,
      },
    });

    const markup = renderToStaticMarkup(
      <NotificationStack
        notifications={store.getState().notifications}
        store={store}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('现在可以继续使用。');
    expect(markup).toContain('打开');
  });
});
