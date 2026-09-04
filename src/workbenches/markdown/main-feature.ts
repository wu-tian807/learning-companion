import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import { isTextRangePayload } from '../../shared/workbench/text-range-target';
import {
  isMarkdownImageTargetPayload,
  MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
  MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
  MARKDOWN_IMAGE_TARGET_TYPE,
  MARKDOWN_IMAGE_TARGET_VERSION,
} from './shared';

function isMarkdownVisualSelectionPayload(
  value: unknown,
): value is { readonly exact: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  const exact = payload.exact;
  return (
    typeof exact === 'string' &&
    exact.length > 0 &&
    (payload.ranges === undefined || isTextRangePayload(payload))
  );
}

export const markdownMainFeature = Object.freeze({
  id: 'builtin.markdown.targets',
  registerAssetTargets({ targets }): void {
    targets.register({
      workbenchId: 'builtin.markdown',
      targetType: MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
      version: 1,
      isPayload: isTextRangePayload,
      agent: {
        description: 'Markdown 源文件中由字符偏移与原文共同标识的一段内容',
        payloadSchema: {
          type: 'object',
          required: ['ranges'],
          properties: {
            ranges: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['start', 'end', 'exact'],
                properties: {
                  start: { type: 'integer', minimum: 0 },
                  end: { type: 'integer', minimum: 0 },
                  exact: { type: 'string' },
                  prefix: { type: 'string' },
                  suffix: { type: 'string' },
                },
              },
            },
          },
        },
        examplePayloads: [
          { ranges: [{ start: 0, end: 2, exact: '示例' }] },
        ],
      },
      describe(payload): string {
        const ranges = (payload as { readonly ranges: readonly { readonly start: number; readonly end: number }[] }).ranges;
        return `Markdown 字符 ${ranges[0]!.start}–${ranges.at(-1)!.end}`;
      },
    });
    targets.register({
      workbenchId: 'builtin.markdown',
      targetType: MARKDOWN_IMAGE_TARGET_TYPE,
      version: MARKDOWN_IMAGE_TARGET_VERSION,
      isPayload: isMarkdownImageTargetPayload,
      agent: {
        description: 'Markdown 文档中引用的一张本地图片',
        payloadSchema: {
          type: 'object',
          required: ['relativePath'],
          properties: {
            relativePath: { type: 'string', minLength: 1 },
          },
        },
        examplePayloads: [{ relativePath: 'images/shot.png' }],
      },
      describe(payload): string {
        return `Markdown 图片 ${(payload as { readonly relativePath: string }).relativePath}`;
      },
    });
    targets.register({
      workbenchId: 'builtin.markdown',
      targetType: MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
      version: 1,
      isPayload: isMarkdownVisualSelectionPayload,
      agent: {
        description: 'Markdown 渲染结果中可由精确原文重新找到的内容',
        payloadSchema: {
          type: 'object',
          required: ['exact'],
          properties: {
            exact: { type: 'string', minLength: 1 },
            ranges: { type: 'array' },
          },
        },
        examplePayloads: [{ exact: '需要定位的原文' }],
      },
      describe(payload): string {
        return `原文“${(payload as { readonly exact: string }).exact}”`;
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
