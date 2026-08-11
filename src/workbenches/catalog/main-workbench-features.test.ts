import { describe, expect, it } from 'vitest';

import { AnchorRegistry } from '../../main/attachments/anchor-registry';
import { AttachmentRegistry } from '../../main/attachments/attachment-registry';
import { AI_ANNOTATION_ATTACHMENT_TYPE, AI_ANNOTATION_ATTACHMENT_VERSION } from '../document-ai/ai-annotation-attachment';
import { OFFICE_ANCHOR_VERSION, OFFICE_REGION_ANCHOR_TYPE } from '../office/shared';
import { PDF_REGION_ANCHOR_TYPE, PDF_REGION_ANCHOR_VERSION } from '../pdf/shared';
import { registerMainWorkbenchAttachmentTypes } from './main-workbench-features';

describe('main Workbench feature catalog', () => {
  it('registers Document AI attachments and PDF/Office region anchors', () => {
    const attachments = new AttachmentRegistry();
    const anchors = new AnchorRegistry();

    registerMainWorkbenchAttachmentTypes({ attachments, anchors });

    expect(attachments.get(AI_ANNOTATION_ATTACHMENT_TYPE, AI_ANNOTATION_ATTACHMENT_VERSION)).toBeDefined();
    expect(anchors.get(PDF_REGION_ANCHOR_TYPE, PDF_REGION_ANCHOR_VERSION)?.isPayload({
      pageNumber: 1, x: 0, y: 0, width: 0.5, height: 0.5,
    })).toBe(true);
    expect(anchors.get(OFFICE_REGION_ANCHOR_TYPE, OFFICE_ANCHOR_VERSION)?.isPayload({
      pageNumber: 1, x: 0.5, y: 0.5, width: 0.5, height: 0.5,
    })).toBe(true);
  });

  it('rejects duplicate catalog registration instead of silently replacing definitions', () => {
    const context = { attachments: new AttachmentRegistry(), anchors: new AnchorRegistry() };
    registerMainWorkbenchAttachmentTypes(context);
    expect(() => registerMainWorkbenchAttachmentTypes(context)).toThrow();
  });
});
