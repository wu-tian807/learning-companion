import { describe, expect, it, vi } from 'vitest';

import { createEpubReadingLocationRestore } from './epub-reading-location';

const SAVED_CFI = 'epubcfi(/6/8!/4/12/2:24)';

describe('EPUB reading location restoration', () => {
  it('repositions a continuous rendition after its surrounding sections finish loading', async () => {
    let finishSecondDisplay: (() => void) | undefined;
    const secondDisplay = new Promise<void>((resolve) => {
      finishSecondDisplay = resolve;
    });
    const display = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(secondDisplay);
    const restore = createEpubReadingLocationRestore(
      'scrolled-doc',
      SAVED_CFI,
    );

    const task = restore.display({ display });

    await Promise.resolve();
    expect(display).toHaveBeenCalledTimes(2);
    expect(display).toHaveBeenNthCalledWith(1, SAVED_CFI);
    expect(display).toHaveBeenNthCalledWith(2, SAVED_CFI);
    expect(restore.shouldPersistRelocation()).toBe(false);

    finishSecondDisplay?.();
    await task;
    expect(restore.shouldPersistRelocation()).toBe(true);
  });

  it('does not repeat restoration for paginated mode', async () => {
    const display = vi.fn().mockResolvedValue(undefined);
    const restore = createEpubReadingLocationRestore(
      'paginated',
      SAVED_CFI,
    );

    await restore.display({ display });

    expect(display).toHaveBeenCalledOnce();
    expect(display).toHaveBeenCalledWith(SAVED_CFI);
  });

  it('allows the initial relocation to establish a location for a new book', async () => {
    const display = vi.fn().mockResolvedValue(undefined);
    const restore = createEpubReadingLocationRestore('scrolled-doc');

    expect(restore.shouldPersistRelocation()).toBe(true);
    await restore.display({ display });

    expect(display).toHaveBeenCalledOnce();
    expect(display).toHaveBeenCalledWith(undefined);
    expect(restore.shouldPersistRelocation()).toBe(true);
  });
});
