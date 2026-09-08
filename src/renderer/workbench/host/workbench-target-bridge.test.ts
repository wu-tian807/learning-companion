import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getWorkbenchTargetSourceRevision,
  registerWorkbenchTargetController,
  resetWorkbenchTargetControllerForTests,
  resolveWorkbenchTarget,
  revealWorkbenchTarget,
  selectAndRevealWorkbenchTarget,
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
      sourceRevision: 'revision-1',
      resolve: () => ({ left: 1, top: 2, width: 3, height: 4 }),
      reveal,
    });

    expect(resolveWorkbenchTarget('asset', target)).toEqual({
      left: 1,
      top: 2,
      width: 3,
      height: 4,
    });
    expect(getWorkbenchTargetSourceRevision('asset')).toBe('revision-1');
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

  it('rejects a content Target after the source revision has changed', async () => {
    const reveal = vi.fn(() => true);
    registerWorkbenchTargetController('pdf', 'asset', {
      sourceRevision: 'revision-new',
      reveal,
    });

    await expect(
      revealWorkbenchTarget('asset', target, 'revision-old'),
    ).rejects.toThrow('引用的资料内容已更新');
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

  it('keeps two viewport controllers for the same Asset isolated', async () => {
    const materialReveal = vi.fn(() => true);
    const notebookReveal = vi.fn(() => true);
    registerWorkbenchTargetController('material-viewport', 'asset', {
      sourceRevision: 'material-revision',
      reveal: materialReveal,
    });
    registerWorkbenchTargetController('notebook-viewport', 'asset', {
      sourceRevision: 'notebook-revision',
      reveal: notebookReveal,
    });

    expect(
      getWorkbenchTargetSourceRevision('asset', 'material-viewport'),
    ).toBe('material-revision');
    expect(
      getWorkbenchTargetSourceRevision('asset', 'notebook-viewport'),
    ).toBe('notebook-revision');
    await revealWorkbenchTarget(
      'asset',
      target,
      'material-revision',
      false,
      'material-viewport',
    );
    expect(materialReveal).toHaveBeenCalledWith(target);
    expect(notebookReveal).not.toHaveBeenCalled();
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

  it('selects another Asset, waits for its Workbench and reveals the versioned Target', async () => {
    const reveal = vi.fn(() => true);
    const emphasize = vi.fn();
    const selectAsset = vi.fn(async (assetId: string) => {
      expect(assetId).toBe('target');
      registerWorkbenchTargetController('epub', assetId, {
        sourceRevision: 'revision-1',
        reveal,
        emphasize,
      });
    });

    await selectAndRevealWorkbenchTarget({
      assetId: 'target',
      target,
      sourceRevision: 'revision-1',
      selectAsset,
      signal: new AbortController().signal,
      emphasize: true,
    });

    expect(selectAsset).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith(target, {
      signal: expect.any(AbortSignal),
    });
    expect(emphasize).toHaveBeenCalledWith(target, {
      signal: expect.any(AbortSignal),
    });
  });

  it('does not select or reveal after navigation has been cancelled', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    const selectAsset = vi.fn();

    await expect(
      selectAndRevealWorkbenchTarget({
        assetId: 'target',
        target,
        selectAsset,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(selectAsset).not.toHaveBeenCalled();
  });

  it('cancels an in-flight reveal before its Workbench commits follow-up navigation', async () => {
    let finishReveal: (() => void) | undefined;
    const reveal = vi.fn(
      (_target, options?: { readonly signal?: AbortSignal }) =>
        new Promise<boolean>((resolve) => {
          expect(options?.signal).toBeDefined();
          finishReveal = () => resolve(true);
        }),
    );
    const emphasize = vi.fn();
    const dispose = registerWorkbenchTargetController('pdf', 'asset', {
      reveal,
      emphasize,
    });
    const controller = new AbortController();
    const navigation = selectAndRevealWorkbenchTarget({
      assetId: 'asset',
      target,
      selectAsset: vi.fn(),
      signal: controller.signal,
      emphasize: true,
      ownerId: 'pdf',
    });

    await vi.waitFor(() => expect(reveal).toHaveBeenCalledOnce());
    controller.abort(new DOMException('newer navigation', 'AbortError'));
    finishReveal!();

    await expect(navigation).rejects.toMatchObject({ name: 'AbortError' });
    expect(emphasize).not.toHaveBeenCalled();
    dispose();
  });

  it('does not complete a reveal after the exact owner registration is replaced', async () => {
    let finishReveal: (() => void) | undefined;
    const reveal = vi.fn(
      () => new Promise<boolean>((resolve) => {
        finishReveal = () => resolve(true);
      }),
    );
    registerWorkbenchTargetController('pdf', 'asset', { reveal });
    const navigation = selectAndRevealWorkbenchTarget({
      assetId: 'asset',
      target,
      selectAsset: vi.fn(),
      signal: new AbortController().signal,
      ownerId: 'pdf',
    });

    await vi.waitFor(() => expect(reveal).toHaveBeenCalledOnce());
    registerWorkbenchTargetController('pdf', 'asset', { reveal: () => true });
    finishReveal!();

    await expect(navigation).rejects.toMatchObject({ name: 'AbortError' });
  });
});
