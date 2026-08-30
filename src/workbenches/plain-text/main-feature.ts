import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import { isTextRangePayload } from '../../shared/workbench/text-range-anchor';
import { PLAIN_TEXT_RANGE_ANCHOR_TYPE } from './shared';

export const plainTextMainFeature = Object.freeze({
  id: 'builtin.plain-text.anchors',
  registerAttachmentTypes({ anchors }): void {
    anchors.register({
      anchorType: PLAIN_TEXT_RANGE_ANCHOR_TYPE,
      version: 1,
      isPayload: isTextRangePayload,
    });
  },
} satisfies MainWorkbenchFeatureContribution);
