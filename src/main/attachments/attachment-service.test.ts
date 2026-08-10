import { describe, expect, it } from 'vitest';

import type { AssetAttachment } from '../../shared/workbench/attachment';
import { AnchorRegistry } from './anchor-registry';
import { AttachmentRegistry } from './attachment-registry';
import { AttachmentService } from './attachment-service';
import type { AttachmentDatabaseApi } from './attachment-database';

function createService() {
  let stored: AssetAttachment | undefined;
  const database: AttachmentDatabaseApi = {
    listByProject: () => stored ? [stored] : [],
    listByAsset: () => stored ? [stored] : [],
    create: (attachment) => (stored = attachment),
    update: (attachment) => (stored = attachment),
    delete: () => { stored = undefined; },
  };
  const attachments = new AttachmentRegistry();
  attachments.register({ typeId: 'note', version: 1, isMetadata: () => true });
  const anchors = new AnchorRegistry();
  anchors.register({
    anchorType: 'pdf.region',
    version: 1,
    isPayload: (value) => typeof value === 'object' && value !== null && 'pageNumber' in value,
  });
  return new AttachmentService(database, attachments, anchors, undefined, undefined, {
    createId: () => 'attachment-id',
    now: () => 1,
  });
}

describe('AttachmentService anchor validation', () => {
  it('accepts registered anchors and whole-asset targets', async () => {
    const service = createService();
    await expect(service.create({
      projectId: 'project', assetId: 'asset', typeId: 'note', typeVersion: 1,
      target: { scope: 'asset' }, metadata: {},
    })).resolves.toMatchObject({ target: { scope: 'asset' } });
    await expect(service.create({
      projectId: 'project', assetId: 'asset', typeId: 'note', typeVersion: 1,
      target: { scope: 'content', anchorType: 'pdf.region', anchorVersion: 1, anchorPayload: { pageNumber: 2 } },
      metadata: {},
    })).resolves.toMatchObject({ target: { anchorType: 'pdf.region' } });
  });

  it('rejects unknown and malformed anchor payloads', async () => {
    const service = createService();
    await expect(service.create({
      projectId: 'project', assetId: 'asset', typeId: 'note', typeVersion: 1,
      target: { scope: 'content', anchorType: 'pdf.region', anchorVersion: 1, anchorPayload: {} },
      metadata: {},
    })).rejects.toThrow('ATTACHMENT_ANCHOR_INVALID');
    await expect(service.create({
      projectId: 'project', assetId: 'asset', typeId: 'note', typeVersion: 1,
      target: { scope: 'content', anchorType: 'missing', anchorVersion: 1, anchorPayload: {} },
      metadata: {},
    })).rejects.toThrow('ATTACHMENT_ANCHOR_INVALID');
  });
});
