import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import { isTextRangePayload } from '../../shared/workbench/text-range-anchor';
import {
  isMarkdownImageAnchorPayload,
  MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
  MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
  MARKDOWN_IMAGE_ANCHOR_TYPE,
  MARKDOWN_IMAGE_ANCHOR_VERSION,
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
  id: 'builtin.markdown.anchors',
  registerAttachmentTypes({ anchors }): void {
    anchors.register({
      anchorType: MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
      version: 1,
      isPayload: isTextRangePayload,
    });
    anchors.register({
      anchorType: MARKDOWN_IMAGE_ANCHOR_TYPE,
      version: MARKDOWN_IMAGE_ANCHOR_VERSION,
      isPayload: isMarkdownImageAnchorPayload,
    });
    anchors.register({
      anchorType: MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
      version: 1,
      isPayload: isMarkdownVisualSelectionPayload,
    });
  },
} satisfies MainWorkbenchFeatureContribution);
