import { randomUUID } from 'node:crypto';

import type {
  AssetAttachment,
  AssetAttachmentContent,
} from '../../shared/attachments/contracts';
import type { AssetTarget } from '../../shared/workbench/anchor';
import type { JsonValue } from '../../shared/workbench/protocol';
import type { AssetLookup } from '../assets/asset-database';
import { AppError } from '../errors/app-error';
import { createAssetAttachment } from './attachment';
import type { AnchorRegistry } from './anchor-registry';
import type { AttachmentContentFile } from './attachment-content-file';
import type { AttachmentDatabaseApi } from './attachment-database';
import type { AttachmentRegistry } from './attachment-registry';

export type AttachmentServiceEvent =
  | { readonly type: 'changed'; readonly attachment: AssetAttachment }
  | { readonly type: 'deleted'; readonly attachment: AssetAttachment };

export type AttachmentServiceListener = (
  event: AttachmentServiceEvent,
) => void | Promise<void>;

export interface CreateAttachmentInput {
  readonly projectId: string;
  readonly assetId: string;
  readonly typeId: string;
  readonly typeVersion: number;
  readonly target: AssetTarget;
  readonly metadata: JsonValue;
  readonly content?: AssetAttachmentContent;
}

export interface CreateAttachmentWithContentInput
  extends Omit<CreateAttachmentInput, 'content'> {
  readonly content: {
    readonly fileName: string;
    readonly mediaType: string;
    readonly data: string | Uint8Array;
  };
}

export interface UpdateAttachmentInput {
  readonly projectId: string;
  readonly attachmentId: string;
  readonly target?: AssetTarget;
  readonly metadata?: JsonValue;
  /** Omit to preserve existing content; use null to clear it. */
  readonly content?: AssetAttachmentContent | null;
}

export interface AttachmentServiceApi {
  get(attachmentId: string): Promise<AssetAttachment | undefined>;
  listByAsset(
    projectId: string,
    assetId: string,
  ): Promise<readonly AssetAttachment[]>;
  readTextContent(
    projectId: string,
    attachmentId: string,
  ): Promise<string | undefined>;
  create(input: CreateAttachmentInput): Promise<AssetAttachment>;
  createWithContent(
    input: CreateAttachmentWithContentInput,
  ): Promise<AssetAttachment>;
  update(input: UpdateAttachmentInput): Promise<AssetAttachment>;
  delete(projectId: string, attachmentId: string): Promise<void>;
  removeByAsset(projectId: string, assetId: string): Promise<void>;
  removeByProject(projectId: string): Promise<void>;
  subscribe(listener: AttachmentServiceListener): () => void;
}

export interface AttachmentServiceDependencies {
  readonly createId: () => string;
  readonly now: () => number;
}

export class AttachmentService implements AttachmentServiceApi {
  private readonly listeners = new Set<AttachmentServiceListener>();
  private readonly dependencies: AttachmentServiceDependencies;

  constructor(
    private readonly database: AttachmentDatabaseApi,
    private readonly registry: AttachmentRegistry,
    private readonly anchors: AnchorRegistry,
    private readonly contentFiles: AttachmentContentFile,
    private readonly assets: AssetLookup,
    dependencies: Partial<AttachmentServiceDependencies> = {},
  ) {
    this.dependencies = {
      createId: dependencies.createId ?? randomUUID,
      now: dependencies.now ?? Date.now,
    };
  }

  async get(attachmentId: string): Promise<AssetAttachment | undefined> {
    return this.database.get(attachmentId);
  }

  async listByAsset(
    projectId: string,
    assetId: string,
  ): Promise<readonly AssetAttachment[]> {
    return this.database.listByAsset(projectId, assetId);
  }

  async readTextContent(
    projectId: string,
    attachmentId: string,
  ): Promise<string | undefined> {
    const attachment = this.requireOwned(projectId, attachmentId);
    if (!attachment.content) {
      return undefined;
    }
    return this.contentFiles.readText(projectId, attachment.content.ref);
  }

  async create(input: CreateAttachmentInput): Promise<AssetAttachment> {
    this.assertRegistered(input.typeId, input.typeVersion, input.metadata);
    this.assertTarget(input.target);
    const now = this.dependencies.now();
    return this.persistCreated(
      this.dependencies.createId(),
      input,
      now,
    );
  }

  async createWithContent(
    input: CreateAttachmentWithContentInput,
  ): Promise<AssetAttachment> {
    this.assertRegistered(input.typeId, input.typeVersion, input.metadata);
    this.assertTarget(input.target);
    const id = this.dependencies.createId();
    const now = this.dependencies.now();
    const content = await this.contentFiles.write({
      projectId: input.projectId,
      attachmentId: id,
      fileName: input.content.fileName,
      mediaType: input.content.mediaType,
      content: input.content.data,
    });

    try {
      return this.persistCreated(id, { ...input, content }, now);
    } catch (error) {
      await this.contentFiles
        .removeAttachment(input.projectId, id)
        .catch((cleanupError: unknown) => {
          console.error('回滚 Attachment 内容文件失败', cleanupError);
        });
      throw error;
    }
  }

  private persistCreated(
    id: string,
    input: CreateAttachmentInput,
    now: number,
  ): AssetAttachment {
    this.requireAsset(input.projectId, input.assetId);
    const candidate = createAssetAttachment({
      id,
      projectId: input.projectId,
      assetId: input.assetId,
      typeId: input.typeId,
      typeVersion: input.typeVersion,
      target: input.target,
      metadata: input.metadata,
      ...(input.content ? { content: input.content } : {}),
      createdTime: now,
      updatedTime: now,
    });
    const created = this.database.create(candidate);
    this.publish({ type: 'changed', attachment: created });
    return created;
  }

  async update(input: UpdateAttachmentInput): Promise<AssetAttachment> {
    const current = this.requireOwned(input.projectId, input.attachmentId);
    this.requireAsset(current.projectId, current.assetId);
    const target = input.target ?? current.target;
    const metadata = input.metadata ?? current.metadata;
    this.assertRegistered(current.typeId, current.typeVersion, metadata);
    this.assertTarget(target);
    const now = Math.max(this.dependencies.now(), current.updatedTime);
    const hasContent = Object.prototype.hasOwnProperty.call(input, 'content');
    const content = hasContent ? input.content ?? undefined : current.content;
    const updated = this.database.update(
      createAssetAttachment({
        ...current,
        target,
        metadata,
        content,
        updatedTime: now,
      }),
    );
    this.publish({ type: 'changed', attachment: updated });
    return updated;
  }

  async delete(projectId: string, attachmentId: string): Promise<void> {
    const current = this.requireOwned(projectId, attachmentId);
    this.requireAsset(current.projectId, current.assetId);
    await this.contentFiles.removeAttachment(current.projectId, current.id);
    this.database.delete(current.id);
    this.publish({
      type: 'deleted',
      attachment: {
        ...current,
        updatedTime: Math.max(this.dependencies.now(), current.updatedTime),
      },
    });
  }

  async removeByAsset(projectId: string, assetId: string): Promise<void> {
    for (const attachment of this.database.listByAsset(projectId, assetId)) {
      await this.contentFiles.removeAttachment(projectId, attachment.id);
      this.database.delete(attachment.id);
      this.publish({ type: 'deleted', attachment });
    }
  }

  async removeByProject(projectId: string): Promise<void> {
    const attachments = this.database.listByProject(projectId);
    await this.contentFiles.removeProject(projectId);
    for (const attachment of attachments) {
      this.database.delete(attachment.id);
      this.publish({ type: 'deleted', attachment });
    }
  }

  subscribe(listener: AttachmentServiceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private requireOwned(projectId: string, attachmentId: string): AssetAttachment {
    const attachment = this.database.get(attachmentId);
    if (!attachment || attachment.projectId !== projectId.trim()) {
      throw new AppError('ATTACHMENT_NOT_FOUND');
    }
    return attachment;
  }

  private requireAsset(projectId: string, assetId: string): void {
    if (!this.assets.get(projectId, assetId)) {
      throw new AppError('ASSET_NOT_FOUND');
    }
  }

  private assertRegistered(
    typeId: string,
    version: number,
    metadata: JsonValue,
  ): void {
    const definition = this.registry.get(typeId, version);
    if (!definition) {
      throw new AppError('ATTACHMENT_TYPE_NOT_REGISTERED');
    }
    if (!definition.isMetadata(metadata)) {
      throw new AppError('ATTACHMENT_METADATA_INVALID');
    }
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

  private publish(event: AttachmentServiceEvent): void {
    for (const listener of this.listeners) {
      try {
        Promise.resolve(listener(event)).catch((error: unknown) => {
          console.error('异步 Attachment 事件订阅者执行失败', error);
        });
      } catch (error) {
        console.error('发布 Attachment 事件失败', error);
      }
    }
  }
}
