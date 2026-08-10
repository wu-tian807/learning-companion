import type { AnchorRegistry } from '../../../main/attachments/anchor-registry';
import type { AttachmentRegistry } from '../../../main/attachments/attachment-registry';
import {
  EPUB_CFI_RANGE_ANCHOR_TYPE,
  EPUB_CFI_RANGE_ANCHOR_VERSION,
  isEpubCfiRangeAnchorV1,
} from '../shared';
import {
  EPUB_EXPLANATION_ATTACHMENT_TYPE,
  EPUB_EXPLANATION_ATTACHMENT_VERSION,
  isEpubExplanationMetadata,
} from './shared';

export function registerEpubExplanationAttachmentTypes(
  attachments: AttachmentRegistry,
  anchors: AnchorRegistry,
): void {
  anchors.register({
    anchorType: EPUB_CFI_RANGE_ANCHOR_TYPE,
    version: EPUB_CFI_RANGE_ANCHOR_VERSION,
    isPayload: isEpubCfiRangeAnchorV1,
  });
  attachments.register({
    typeId: EPUB_EXPLANATION_ATTACHMENT_TYPE,
    version: EPUB_EXPLANATION_ATTACHMENT_VERSION,
    isMetadata: isEpubExplanationMetadata,
  });
}
