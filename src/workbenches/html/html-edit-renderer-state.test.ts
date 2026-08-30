import { describe, expect, it, vi } from 'vitest';

import {
  HTML_STALE_HISTORICAL_ANCHOR_MESSAGE,
  HtmlEditReloadQueue,
  shouldRefreshHtmlDraftPreview,
  staleHistoricalAnchorMessage,
} from './html-edit-renderer-state';

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('HtmlEditReloadQueue', () => {
  it('starts exactly one reload for each queued applied operation', async () => {
    const queue = new HtmlEditReloadQueue();
    const reload = vi.fn();

    queue.enqueue(reload);
    queue.enqueue(reload);
    queue.enqueue(reload);
    await flushMicrotasks();
    expect(reload).toHaveBeenCalledTimes(1);

    expect(queue.complete()).toBe(true);
    await flushMicrotasks();
    expect(reload).toHaveBeenCalledTimes(2);

    expect(queue.complete()).toBe(true);
    await flushMicrotasks();
    expect(reload).toHaveBeenCalledTimes(3);

    expect(queue.complete()).toBe(true);
    await queue.drain();
    expect(queue.complete()).toBe(false);
  });

  it('drops queued work after dispose and releases an active reload', async () => {
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

describe('historical HTML Anchor lookup', () => {
  it('warns only when an active historical lookup returns found false', () => {
    expect(staleHistoricalAnchorMessage(true, false)).toBe(
      HTML_STALE_HISTORICAL_ANCHOR_MESSAGE,
    );
    expect(staleHistoricalAnchorMessage(true, true)).toBeUndefined();
    expect(staleHistoricalAnchorMessage(false, false)).toBeUndefined();
  });
});

describe('HTML draft preview recovery', () => {
  it('refreshes a missed first or changed draft but not an already applied revision', () => {
    expect(shouldRefreshHtmlDraftPreview(undefined, 'draft-1')).toBe(true);
    expect(shouldRefreshHtmlDraftPreview('draft-1', 'draft-2')).toBe(true);
    expect(shouldRefreshHtmlDraftPreview('draft-2', 'draft-2')).toBe(false);
  });
});
