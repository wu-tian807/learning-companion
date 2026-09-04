import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import {
  EPUB_CFI_RANGE_ANCHOR_TYPE,
  EPUB_CFI_RANGE_ANCHOR_VERSION,
  isEpubCfiRangeAnchorV1,
} from './shared';

export const epubTargetMainFeature = Object.freeze({
  id: 'builtin.epub.targets',
  registerAssetTargets({ targets }): void {
    targets.register({
      workbenchId: 'builtin.epub',
      targetType: EPUB_CFI_RANGE_ANCHOR_TYPE,
      version: EPUB_CFI_RANGE_ANCHOR_VERSION,
      isPayload: isEpubCfiRangeAnchorV1,
      agent: {
        description: 'EPUB 中由标准 CFI 范围与原文共同标识的内容；无法可靠生成 CFI 时使用整份资料 Target',
        payloadSchema: {
          type: 'object',
          required: ['cfiRange', 'quote'],
          properties: {
            cfiRange: { type: 'string', pattern: '^epubcfi\\(.+\\)$' },
            quote: {
              type: 'object',
              required: ['exact', 'prefix', 'suffix'],
              properties: {
                exact: { type: 'string', minLength: 1 },
                prefix: { type: 'string' },
                suffix: { type: 'string' },
              },
            },
          },
        },
        examplePayloads: [{
          cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
          quote: { exact: '示例原文', prefix: '', suffix: '' },
        }],
      },
      describe(payload): string {
        return `原文“${(payload as { readonly quote: { readonly exact: string } }).quote.exact}”`;
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
