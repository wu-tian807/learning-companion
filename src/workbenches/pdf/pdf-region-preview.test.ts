// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { capturePdfRegionPreview } from './renderer';

describe('PDF and Office selected-region preview', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps slide text substantially larger than the old 180px preview', () => {
    const drawImage = vi.fn();
    const preview = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL: () => 'data:image/jpeg;base64,c2xpZGU=',
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockImplementation(() => preview as never);
    const source = { width: 1600, height: 900 } as HTMLCanvasElement;

    const result = capturePdfRegionPreview(source, {
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.4,
    });

    expect(result).toMatch(/^data:image\/jpeg/u);
    expect(preview.width).toBe(800);
    expect(preview.height).toBe(360);
    expect(preview.width).toBeGreaterThan(180);
    expect(drawImage).toHaveBeenCalledOnce();
  });

  it('rejects previews that cannot fit the persisted context limit', () => {
    const preview = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: () => `data:image/jpeg;base64,${'x'.repeat(60 * 1_024)}`,
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockImplementation(() => preview as never);

    expect(capturePdfRegionPreview(
      { width: 1600, height: 900 } as HTMLCanvasElement,
      { x: 0, y: 0, width: 1, height: 1 },
    )).toBeUndefined();
  });
});
