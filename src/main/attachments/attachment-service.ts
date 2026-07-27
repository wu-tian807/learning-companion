import type { AssetAttachment } from '../../shared/workbench/attachment';
import { AppError } from '../errors/app-error';

export interface AttachmentServiceApi {
  listByAsset(assetId: string): Promise<readonly AssetAttachment[]>;
  create(attachment: AssetAttachment): Promise<AssetAttachment>;
  update(attachment: AssetAttachment): Promise<AssetAttachment>;
  delete(attachmentId: string): Promise<void>;
}

export class EmptyAttachmentService implements AttachmentServiceApi {
  async listByAsset(_assetId: string): Promise<readonly AssetAttachment[]> {
    void _assetId;
    return [];
  }

  async create(_attachment: AssetAttachment): Promise<AssetAttachment> {
    void _attachment;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async update(_attachment: AssetAttachment): Promise<AssetAttachment> {
    void _attachment;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async delete(_attachmentId: string): Promise<void> {
    void _attachmentId;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }
}
