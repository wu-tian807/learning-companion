import type { MainWorkbenchContribution } from '../catalog/register-main-workbenches';
import {
  PDF_PAGE_ANCHOR_TYPE,
  PDF_PAGE_ANCHOR_VERSION,
  PDF_REGION_ANCHOR_TYPE,
  PDF_REGION_ANCHOR_VERSION,
  PDF_TEXT_RANGE_ANCHOR_TYPE,
  PDF_TEXT_RANGE_ANCHOR_VERSION,
  isPdfPageAnchorV1,
  isPdfRegionAnchorV1,
  isPdfTextRangeAnchorV1,
} from './shared';

export const pdfAnchorMainFeature = Object.freeze({
  id: 'builtin.pdf.anchors',
  registerAttachmentTypes({ anchors }): void {
    anchors.register({ anchorType: PDF_TEXT_RANGE_ANCHOR_TYPE, version: PDF_TEXT_RANGE_ANCHOR_VERSION, isPayload: isPdfTextRangeAnchorV1 });
    anchors.register({ anchorType: PDF_PAGE_ANCHOR_TYPE, version: PDF_PAGE_ANCHOR_VERSION, isPayload: isPdfPageAnchorV1 });
    anchors.register({ anchorType: PDF_REGION_ANCHOR_TYPE, version: PDF_REGION_ANCHOR_VERSION, isPayload: isPdfRegionAnchorV1 });
  },
} satisfies MainWorkbenchContribution);
