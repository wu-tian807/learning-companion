import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import { isTextRangePayload } from '../../shared/workbench/text-range-anchor';
import {
  MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
  MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
} from './shared';

function isMarkdownVisualSelectionPayload(
  value: unknown,
): value is { readonly exact: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const exact = (value as Record<string, unknown>).exact;
  return typeof exact === 'string' && exact.length > 0;
}

export const markdownMainFeature = Object.freeze({
  id: 'builtin.markdown.anchors',
  registerAttachmentTypes({ anchors }): void {
    anchors.register({
      anchorType: MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
      version: 1,
      isPayload: isTextRangePayload,
    });
    anchors.register({
      anchorType: MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
      version: 1,
      isPayload: isMarkdownVisualSelectionPayload,
    });
  },
} satisfies MainWorkbenchFeatureContribution);
