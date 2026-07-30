import { describe, expect, it } from 'vitest';

import { AnchorRegistry } from './anchor-registry';
import { AttachmentRegistry } from './attachment-registry';

describe('Attachment and Anchor registries', () => {
  it('registers definitions independently by type and version', () => {
    const attachments = new AttachmentRegistry();
    const anchors = new AnchorRegistry();
    const attachment = {
      typeId: 'user-note',
      version: 1,
      isMetadata: () => true,
    };
    const anchor = {
      anchorType: 'markdown.text-range',
      version: 1,
      isPayload: () => true,
    };

    attachments.register(attachment);
    anchors.register(anchor);

    expect(attachments.get('user-note', 1)).toBe(attachment);
    expect(anchors.get('markdown.text-range', 1)).toBe(anchor);
    expect(attachments.get('user-note', 2)).toBeUndefined();
  });

  it('rejects duplicates and invalid definitions', () => {
    const attachments = new AttachmentRegistry();
    const definition = {
      typeId: 'highlight',
      version: 1,
      isMetadata: () => true,
    };

    attachments.register(definition);

    expect(() => attachments.register(definition)).toThrow(
      'REGISTRATION_CONFLICT',
    );
    expect(() =>
      new AnchorRegistry().register({
        anchorType: '',
        version: 0,
        isPayload: () => true,
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
  });
});
