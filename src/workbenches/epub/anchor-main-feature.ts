import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import {
  EPUB_CFI_RANGE_ANCHOR_TYPE,
  EPUB_CFI_RANGE_ANCHOR_VERSION,
  isEpubCfiRangeAnchorV1,
} from './shared';

export const epubAnchorMainFeature = Object.freeze({
  id: 'builtin.epub.anchors',
  registerAttachmentTypes({ anchors }): void {
    anchors.register({
      anchorType: EPUB_CFI_RANGE_ANCHOR_TYPE,
      version: EPUB_CFI_RANGE_ANCHOR_VERSION,
      isPayload: isEpubCfiRangeAnchorV1,
    });
  },
} satisfies MainWorkbenchFeatureContribution);
