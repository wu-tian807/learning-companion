import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import { isTextRangePayload } from '../../shared/workbench/text-range-target';
import { PLAIN_TEXT_RANGE_ANCHOR_TYPE } from './shared';

export const plainTextMainFeature = Object.freeze({
  id: 'builtin.plain-text.targets',
  registerAssetTargets({ targets }): void {
    targets.register({
      workbenchId: 'builtin.plain-text',
      targetType: PLAIN_TEXT_RANGE_ANCHOR_TYPE,
      version: 1,
      isPayload: isTextRangePayload,
      agent: {
        description: '纯文本中由字符偏移与原文共同标识的一段内容',
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
          { ranges: [{ start: 0, end: 4, exact: '示例' }] },
        ],
      },
      describe(payload): string {
        const ranges = (payload as { readonly ranges: readonly { readonly start: number; readonly end: number }[] }).ranges;
        return `字符 ${ranges[0]!.start}–${ranges.at(-1)!.end}`;
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
