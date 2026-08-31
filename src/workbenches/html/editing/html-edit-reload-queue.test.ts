import { describe, expect, it, vi } from 'vitest';

import { HtmlEditReloadQueue } from './html-edit-reload-queue';

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('HtmlEditReloadQueue', () => {
  it('starts one completed iframe refresh for each queued draft revision', async () => {
    const queue = new HtmlEditReloadQueue();
    const reload = vi.fn();

    queue.enqueue(reload);
    queue.enqueue(reload);
    await flushMicrotasks();
    expect(reload).toHaveBeenCalledOnce();

    expect(queue.complete()).toBe(true);
    await flushMicrotasks();
    expect(reload).toHaveBeenCalledTimes(2);

    expect(queue.complete()).toBe(true);
    await queue.drain();
  });

  it('drops queued refreshes and releases the active refresh on dispose', async () => {
    const queue = new HtmlEditReloadQueue();
    const reload = vi.fn();
    queue.enqueue(reload);
    queue.enqueue(reload);
    await flushMicrotasks();

    queue.dispose();
    await queue.drain();

    expect(reload).toHaveBeenCalledOnce();
  });
});
