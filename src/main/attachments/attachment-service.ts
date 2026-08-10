import { randomUUID } from 'node:crypto';

import type { AssetAttachment } from '../../shared/workbench/attachment';
import type { AssetTarget } from '../../shared/workbench/anchor';
import type { JsonValue } from '../../shared/workbench/protocol';
import {
  cloneAssetAttachment,
  createAssetAttachment,
} from './attachment';
import type {
  AttachmentDatabaseApi,
  AttachmentDatabaseDependencies,
} from './attachment-database';
import type { AttachmentRegistry } from './attachment-registry';
import type { AnchorRegistry } from './anchor-registry';
import type { AttachmentContentStore } from './attachment-content-store';
import { AppError } from '../errors/app-error';

export interface CreateAttachmentInput {
  readonly projectId: string;
  readonly assetId: string;
  readonly typeId: string;
  readonly typeVersion: number;
  readonly target: AssetTarget;
  readonly metadata: JsonValue;
  readonly content?: AssetAttachment['content'];
  readonly body?: JsonValue;
}

export interface AttachmentServiceApi {
  listByAsset(
    projectId: string,
    assetId: string,
  ): Promise<readonly AssetAttachment[]>;
  create(input: CreateAttachmentInput): Promise<AssetAttachment>;
  update(attachment: AssetAttachment): Promise<AssetAttachment>;
  delete(projectId: string, attachmentId: string): Promise<void>;
  readContent(projectId: string, attachmentId: string): Promise<JsonValue>;
}

export class AttachmentService implements AttachmentServiceApi {
  private readonly dependencies: AttachmentDatabaseDependencies;

  constructor(
    private readonly database: AttachmentDatabaseApi,
    private readonly registry: AttachmentRegistry,
    private readonly anchors: AnchorRegistry,
    private readonly contentStore?: AttachmentContentStore,
    private readonly touchAsset?: (assetId: string) => void,
    dependencies: Partial<AttachmentDatabaseDependencies> = {},
  ) {
    this.dependencies = {
      createId: dependencies.createId ?? randomUUID,
      now: dependencies.now ?? Date.now,
    };
  }

  async listByAsset(
    projectId: string,
    assetId: string,
  ): Promise<readonly AssetAttachment[]> {
    if (!projectId || !assetId) {
      return [];
    }

    return this.database.listByAsset(
      projectId.trim(),
      assetId.trim(),
    );
  }

  async create(
    input: CreateAttachmentInput,
  ): Promise<AssetAttachment> {
    const definition = this.registry.get(input.typeId, input.typeVersion);

    if (!definition) {
      throw new AppError('ATTACHMENT_TYPE_NOT_REGISTERED');
    }

    if (!definition.isMetadata(input.metadata)) {
      throw new AppError('ATTACHMENT_METADATA_INVALID');
    }

    this.assertTarget(input.target);

    const now = this.dependencies.now();
    const id = this.dependencies.createId();
    const content = input.body === undefined
      ? input.content
      : await this.requireContentStore().write(input.projectId, id, input.body);
    const attachment = createAssetAttachment({
      id,
      projectId: input.projectId,
      assetId: input.assetId,
      typeId: input.typeId,
      typeVersion: input.typeVersion,
      target: input.target,
      metadata: input.metadata,
      content,
      createdTime: now,
      updatedTime: now,
    });

    try {
      const created = this.database.create(attachment);
      this.trackAsset(input.assetId);
      return created;
    } catch (error) {
      if (content && input.body !== undefined) {
        await this.contentStore?.remove(input.projectId, content).catch(() => undefined);
      }
      throw error;
    }
  }

  async update(attachment: AssetAttachment): Promise<AssetAttachment> {
    const definition = this.registry.get(
      attachment.typeId,
      attachment.typeVersion,
    );

    if (!definition) {
      throw new AppError('ATTACHMENT_TYPE_NOT_REGISTERED');
    }

    if (!definition.isMetadata(attachment.metadata)) {
      throw new AppError('ATTACHMENT_METADATA_INVALID');
    }

    this.assertTarget(attachment.target);

    const updated = cloneAssetAttachment({
      ...attachment,
      updatedTime: this.dependencies.now(),
    });

    const result = this.database.update(updated);
    this.trackAsset(attachment.assetId);
    return result;
  }

  private assertTarget(target: AssetTarget): void {
    if (target.scope === 'asset') {
      return;
    }

    const definition = this.anchors.get(
      target.anchorType,
      target.anchorVersion,
    );
    if (!definition || !definition.isPayload(target.anchorPayload)) {
      throw new AppError('ATTACHMENT_ANCHOR_INVALID');
    }
  }

  async delete(
    projectId: string,
    attachmentId: string,
  ): Promise<void> {
    const normalizedProjectId = projectId.trim();
    const normalizedAttachmentId = attachmentId.trim();
    const attachment = this.database.listByProject(normalizedProjectId)
      .find((item) => item.id === normalizedAttachmentId);
    this.database.delete(normalizedProjectId, normalizedAttachmentId);
    if (attachment?.content) {
      await this.contentStore?.remove(normalizedProjectId, attachment.content);
    }
    if (attachment) this.trackAsset(attachment.assetId);
  }

  async readContent(projectId: string, attachmentId: string): Promise<JsonValue> {
    const attachment = this.database.listByProject(projectId.trim())
      .find((item) => item.id === attachmentId.trim());
    if (!attachment?.content) throw new AppError('ATTACHMENT_NOT_FOUND');
    return this.requireContentStore().read(projectId.trim(), attachment.content);
  }

  private requireContentStore(): AttachmentContentStore {
    if (!this.contentStore) throw new AppError('SERVICE_NOT_READY');
    return this.contentStore;
  }

  private trackAsset(assetId: string): void {
    try {
      this.touchAsset?.(assetId);
    } catch (error) {
      console.error('Failed to update Asset tracking after Attachment change', error);
    }
  }
}

export class EmptyAttachmentService implements AttachmentServiceApi {
  async listByAsset(
    _projectId: string,
    _assetId: string,
  ): Promise<readonly AssetAttachment[]> {
    void _projectId;
    void _assetId;
    return [];
  }

  async create(_input: CreateAttachmentInput): Promise<AssetAttachment> {
    void _input;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async update(_attachment: AssetAttachment): Promise<AssetAttachment> {
    void _attachment;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async delete(
    _projectId: string,
    _attachmentId: string,
  ): Promise<void> {
    void _projectId;
    void _attachmentId;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async readContent(_projectId: string, _attachmentId: string): Promise<JsonValue> {
    void _projectId;
    void _attachmentId;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }
}
