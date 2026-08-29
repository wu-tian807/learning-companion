import { describe, expect, it, vi } from 'vitest';

import { createTextRangeTarget } from '../../shared/workbench/text-range-anchor';
import {
  MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
  MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
} from './shared';
import { markdownMainFeature } from './main-feature';

describe('markdown anchor registration', () => {
  it('accepts source ranges and visual selection payloads', () => {
    const register = vi.fn();
    markdownMainFeature.registerAttachmentTypes?.({
      anchors: { register },
    } as never);

    const definitions = register.mock.calls.map(
      (call) => call[0] as {
        anchorType: string;
        version: number;
        isPayload: (value: unknown) => boolean;
      },
    );
    const source = definitions.find(
      (definition) =>
        definition.anchorType === MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
    );
    const visual = definitions.find(
      (definition) =>
        definition.anchorType === MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
    );

    expect(source).toBeDefined();
    expect(visual).toBeDefined();
    const sourceTarget = createTextRangeTarget(
      MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
      'hello world',
      [{ start: 0, end: 5 }],
    );
    expect(source?.isPayload(sourceTarget.anchorPayload)).toBe(true);
    expect(visual?.isPayload({ exact: '选中文字' })).toBe(true);
    expect(visual?.isPayload({
      exact: '选中文字',
      ranges: [{ start: 2, end: 7 }],
    })).toBe(true);
    expect(visual?.isPayload({
      exact: '选中文字',
      ranges: [{ start: 7, end: 2 }],
    })).toBe(false);
    expect(visual?.isPayload({ exact: '' })).toBe(false);
  });
});
