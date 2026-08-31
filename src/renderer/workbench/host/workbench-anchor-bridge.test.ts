import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerWorkbenchAnchorController,
  resetWorkbenchAnchorControllerForTests,
  resolveWorkbenchAnchor,
  revealWorkbenchAnchor,
  waitForWorkbenchAnchorController,
} from './workbench-anchor-bridge';

const target = {
  scope: 'content' as const,
  anchorType: 'pdf.region',
  anchorVersion: 1,
  anchorPayload: { pageNumber: 6 },
};

describe('workbench anchor bridge', () => {
  afterEach(() => {
    resetWorkbenchAnchorControllerForTests();
    vi.useRealTimers();
  });

  it('routes every anchor operation through the active Asset controller', async () => {
    const reveal = vi.fn(() => true);
    registerWorkbenchAnchorController('pdf', 'asset', {
      resolve: () => ({ left: 1, top: 2, width: 3, height: 4 }),
      reveal,
    });

    expect(resolveWorkbenchAnchor('asset', target)).toEqual({
      left: 1,
      top: 2,
      width: 3,
      height: 4,
    });
    await expect(revealWorkbenchAnchor('asset', target)).resolves.toBeUndefined();
    expect(reveal).toHaveBeenCalledWith(target);
  });

  it('does not let stale cleanup remove a replacement controller', async () => {
    const dispose = registerWorkbenchAnchorController('old', 'asset', {
      reveal: () => false,
    });
    const replacement = vi.fn(() => true);
    registerWorkbenchAnchorController('new', 'asset', { reveal: replacement });
    dispose();
    await Promise.resolve();

    await revealWorkbenchAnchor('asset', target);
    expect(replacement).toHaveBeenCalledOnce();
  });

  it('waits for a cross-Asset Workbench controller and supports cancellation', async () => {
    const waiting = waitForWorkbenchAnchorController(
      'target',
      new AbortController().signal,
    );
    registerWorkbenchAnchorController('video', 'target', { reveal: () => true });
    await expect(waiting).resolves.toBeUndefined();

    const controller = new AbortController();
    const cancelledWait = waitForWorkbenchAnchorController(
      'other',
      controller.signal,
    );
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(cancelledWait).rejects.toMatchObject({ name: 'AbortError' });
  });
});
