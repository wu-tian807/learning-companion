import type { AssetAttachment } from '../../shared/workbench/attachment';
import { AppError } from '../errors/app-error';
import type { AttachmentDatabaseApi } from './attachment-database';

export type AttachmentServiceEvent =
  | { readonly type: 'changed'; readonly attachment: AssetAttachment }
  | {
      readonly type: 'deleted';
      readonly projectId: string;
      readonly assetId: string;
      readonly attachmentId: string;
    };

export type AttachmentServiceListener = (
  event: AttachmentServiceEvent,
) => void;

export interface AttachmentServiceApi {
  get(attachmentId: string): Promise<AssetAttachment | undefined>;
  listByAsset(assetId: string): Promise<readonly AssetAttachment[]>;
  create(attachment: AssetAttachment): Promise<AssetAttachment>;
  update(attachment: AssetAttachment): Promise<AssetAttachment>;
  delete(attachmentId: string): Promise<void>;
  subscribe(listener: AttachmentServiceListener): () => void;
}

export class EmptyAttachmentService implements AttachmentServiceApi {
  async get(_attachmentId: string): Promise<AssetAttachment | undefined> {
    void _attachmentId;
    return undefined;
  }

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

  subscribe(_listener: AttachmentServiceListener): () => void {
    void _listener;
    return () => undefined;
  }
}

export class AttachmentService implements AttachmentServiceApi {
  private readonly listeners = new Set<AttachmentServiceListener>();

  constructor(private readonly database: AttachmentDatabaseApi) {}

  async get(attachmentId: string): Promise<AssetAttachment | undefined> {
    return this.database.get(attachmentId);
  }

  async listByAsset(assetId: string): Promise<readonly AssetAttachment[]> {
    return this.database.listByAsset(assetId);
  }

  async create(attachment: AssetAttachment): Promise<AssetAttachment> {
    const created = this.database.create(attachment);
    this.publish({ type: 'changed', attachment: created });
    return created;
  }

  async update(attachment: AssetAttachment): Promise<AssetAttachment> {
    const updated = this.database.update(attachment);
    this.publish({ type: 'changed', attachment: updated });
    return updated;
  }

  async delete(attachmentId: string): Promise<void> {
    const current = this.database.get(attachmentId);

    if (!current) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    this.database.delete(attachmentId);
    this.publish({
      type: 'deleted',
      projectId: current.projectId,
      assetId: current.assetId,
      attachmentId: current.id,
    });
  }

  subscribe(listener: AttachmentServiceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(event: AttachmentServiceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('发布 Attachment 事件失败', error);
      }
    }
  }
}
