import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerWorkbenchTargetController,
  resetWorkbenchTargetControllerForTests,
  resolveWorkbenchTarget,
  revealWorkbenchTarget,
  waitForWorkbenchTargetController,
} from './workbench-target-bridge';

const target = {
  scope: 'content' as const,
  targetType: 'pdf.region',
  targetVersion: 1,
  targetPayload: { pageNumber: 6 },
};

describe('workbench Target bridge', () => {
  afterEach(() => {
    resetWorkbenchTargetControllerForTests();
    vi.useRealTimers();
  });

  it('routes every content Target operation through the active Asset controller', async () => {
    const reveal = vi.fn(() => true);
    registerWorkbenchTargetController('pdf', 'asset', {
      resolve: () => ({ left: 1, top: 2, width: 3, height: 4 }),
      reveal,
    });

    expect(resolveWorkbenchTarget('asset', target)).toEqual({
      left: 1,
      top: 2,
      width: 3,
      height: 4,
    });
    await expect(revealWorkbenchTarget('asset', target)).resolves.toBeUndefined();
    expect(reveal).toHaveBeenCalledWith(target);
  });

  it('treats the selected Asset as the reveal result for an asset-scoped Target', async () => {
    const reveal = vi.fn(() => false);
    registerWorkbenchTargetController('pdf', 'asset', { reveal });

    await expect(
      revealWorkbenchTarget('asset', { scope: 'asset' }, 'stale-revision'),
    ).resolves.toBeUndefined();
    expect(reveal).not.toHaveBeenCalled();
  });

  it('does not let stale cleanup remove a replacement controller', async () => {
    const dispose = registerWorkbenchTargetController('old', 'asset', {
      reveal: () => false,
    });
    const replacement = vi.fn(() => true);
    registerWorkbenchTargetController('new', 'asset', { reveal: replacement });
    dispose();
    await Promise.resolve();

    await revealWorkbenchTarget('asset', target);
    expect(replacement).toHaveBeenCalledOnce();
  });

  it('waits for a cross-Asset Workbench controller and supports cancellation', async () => {
    const waiting = waitForWorkbenchTargetController(
      'target',
      new AbortController().signal,
    );
    registerWorkbenchTargetController('video', 'target', { reveal: () => true });
    await expect(waiting).resolves.toBeUndefined();

    const controller = new AbortController();
    const cancelledWait = waitForWorkbenchTargetController(
      'other',
      controller.signal,
    );
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(cancelledWait).rejects.toMatchObject({ name: 'AbortError' });
  });
});
