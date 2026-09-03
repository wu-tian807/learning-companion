import { describe, expect, it, vi } from 'vitest';

import { createTextRangeTarget } from '../../shared/workbench/text-range-target';
import {
  createMarkdownImageTarget,
  isMarkdownImageTargetPayload,
  MARKDOWN_IMAGE_TARGET_TYPE,
  MARKDOWN_IMAGE_TARGET_VERSION,
  MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
  MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
} from './shared';
import { markdownMainFeature } from './main-feature';

describe('markdown Target registration', () => {
  it('accepts source ranges and visual selection payloads', () => {
    const register = vi.fn();
    markdownMainFeature.registerAssetTargets?.({
      targets: { register },
    } as never);

    const definitions = register.mock.calls.map(
      (call) => call[0] as {
        targetType: string;
        version: number;
        isPayload: (value: unknown) => boolean;
      },
    );
    const source = definitions.find(
      (definition) =>
        definition.targetType === MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
    );
    const visual = definitions.find(
      (definition) =>
        definition.targetType === MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
    );
    const image = definitions.find(
      (definition) =>
        definition.targetType === MARKDOWN_IMAGE_TARGET_TYPE,
    );

    expect(source).toBeDefined();
    expect(visual).toBeDefined();
    expect(image).toBeDefined();
    const sourceTarget = createTextRangeTarget(
      MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
      'hello world',
      [{ start: 0, end: 5 }],
    );
    expect(source?.isPayload(sourceTarget.targetPayload)).toBe(true);
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
    expect(image?.version).toBe(MARKDOWN_IMAGE_TARGET_VERSION);
    const imageTarget = createMarkdownImageTarget(
      'images/shot.png',
    );
    expect(
      isMarkdownImageTargetPayload(imageTarget.targetPayload),
    ).toBe(true);
    expect(image?.isPayload(imageTarget.targetPayload)).toBe(true);
    expect(image?.isPayload({ relativePath: '../secret.png' })).toBe(
      false,
    );
  });
});
