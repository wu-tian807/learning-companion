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
import { AppError } from '../errors/app-error';

export interface CreateAttachmentInput {
  readonly projectId: string;
  readonly assetId: string;
  readonly typeId: string;
  readonly typeVersion: number;
  readonly target: AssetTarget;
  readonly metadata: JsonValue;
  readonly content?: AssetAttachment['content'];
}

export interface AttachmentServiceApi {
  listByAsset(
    projectId: string,
    assetId: string,
  ): Promise<readonly AssetAttachment[]>;
  create(input: CreateAttachmentInput): Promise<AssetAttachment>;
  update(attachment: AssetAttachment): Promise<AssetAttachment>;
  delete(projectId: string, attachmentId: string): Promise<void>;
}

export class AttachmentService implements AttachmentServiceApi {
  private readonly dependencies: AttachmentDatabaseDependencies;

  constructor(
    private readonly database: AttachmentDatabaseApi,
    private readonly registry: AttachmentRegistry,
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

    const now = this.dependencies.now();
    const attachment = createAssetAttachment({
      id: this.dependencies.createId(),
      projectId: input.projectId,
      assetId: input.assetId,
      typeId: input.typeId,
      typeVersion: input.typeVersion,
      target: input.target,
      metadata: input.metadata,
      content: input.content,
      createdTime: now,
      updatedTime: now,
    });

    return this.database.create(attachment);
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

    const updated = cloneAssetAttachment({
      ...attachment,
      updatedTime: this.dependencies.now(),
    });

    return this.database.update(updated);
  }

  async delete(
    projectId: string,
    attachmentId: string,
  ): Promise<void> {
    this.database.delete(projectId.trim(), attachmentId.trim());
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
}