import { describe, expect, it } from 'vitest';

import { AttachmentRegistry } from './attachment-registry';

describe('AttachmentRegistry', () => {
  it('registers definitions by type and version', () => {
    const attachments = new AttachmentRegistry();
    const attachment = {
      typeId: 'user-note',
      version: 1,
      isMetadata: () => true,
    };

    attachments.register(attachment);

    expect(attachments.get('user-note', 1)).toBe(attachment);
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
  });
});
