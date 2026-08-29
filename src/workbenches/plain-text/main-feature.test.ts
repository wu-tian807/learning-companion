import { describe, expect, it, vi } from 'vitest';

import { createTextRangeTarget } from '../../shared/workbench/text-range-anchor';
import { PLAIN_TEXT_RANGE_ANCHOR_TYPE } from './shared';
import { plainTextMainFeature } from './main-feature';

describe('plain text anchor registration', () => {
  it('accepts text range targets created by the renderer', () => {
    const register = vi.fn();
    plainTextMainFeature.registerAttachmentTypes?.({
      anchors: { register },
    } as never);

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorType: PLAIN_TEXT_RANGE_ANCHOR_TYPE,
        version: 1,
      }),
    );
    const definition = register.mock.calls[0]![0] as {
      isPayload: (value: unknown) => boolean;
    };
    const target = createTextRangeTarget(
      PLAIN_TEXT_RANGE_ANCHOR_TYPE,
      'hello world',
      [{ start: 0, end: 5 }],
    );
    expect(definition.isPayload(target.anchorPayload)).toBe(true);
    expect(definition.isPayload({ ranges: [{ start: 1, end: 0 }] })).toBe(
      false,
    );
  });
});
