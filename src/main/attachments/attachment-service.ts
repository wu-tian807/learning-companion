import { randomUUID } from 'node:crypto';

import type {
  AssetAttachment,
  AssetAttachmentContent,
} from '../../shared/attachments/contracts';
import type { AssetTarget } from '../../shared/workbench/asset-target';
import type { JsonValue } from '../../shared/workbench/protocol';
import type { AssetLookup } from '../assets/asset-database';
import { AppError } from '../errors/app-error';
import { createAssetAttachment } from './attachment';
import type { AssetTargetRegistryApi } from '../workbench/asset-target-registry';
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

export interface UpdateAttachmentWithContentInput
  extends Omit<UpdateAttachmentInput, 'content'> {
  readonly content: {
    readonly fileName: string;
    readonly mediaType: string;
    readonly data: string | Uint8Array;
  };
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
  updateWithContent(
    input: UpdateAttachmentWithContentInput,
  ): Promise<AssetAttachment>;
  delete(projectId: string, attachmentId: string): Promise<void>;
  removeByAsset(projectId: string, assetId: string): Promise<void>;
  subscribe(listener: AttachmentServiceListener): () => void;
}

export interface AttachmentServiceDependencies {
  readonly createId: () => string;
  readonly now: () => number;
}

export class AttachmentService implements AttachmentServiceApi {
  private readonly listeners = new Set<AttachmentServiceListener>();
  private readonly mutationTails = new Map<string, Promise<void>>();
  private readonly pendingContentCleanups = new Map<
    string,
    { readonly projectId: string; readonly ref: AssetAttachmentContent['ref'] }
  >();
  private readonly dependencies: AttachmentServiceDependencies;

  constructor(
    private readonly database: AttachmentDatabaseApi,
    private readonly registry: AttachmentRegistry,
    private readonly targets: AssetTargetRegistryApi,
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
    return this.enqueueMutation(input.attachmentId, async () => {
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
    });
  }

  async updateWithContent(
    input: UpdateAttachmentWithContentInput,
  ): Promise<AssetAttachment> {
    return this.enqueueMutation(input.attachmentId, async () => {
      await this.retryPendingContentCleanups();
      const current = this.requireOwned(input.projectId, input.attachmentId);
      this.requireAsset(current.projectId, current.assetId);
      const target = input.target ?? current.target;
      const metadata = input.metadata ?? current.metadata;
      this.assertRegistered(current.typeId, current.typeVersion, metadata);
      this.assertTarget(target);
      const now = Math.max(this.dependencies.now(), current.updatedTime);
      const content = await this.contentFiles.write({
        projectId: input.projectId,
        attachmentId: current.id,
        // An update must never write over the file referenced by the current
        // row. The database update below is the ownership/visibility boundary.
        fileName: `${input.content.fileName}.${randomUUID()}`,
        mediaType: input.content.mediaType,
        content: input.content.data,
      });
      const updated = createAssetAttachment({
        ...current,
        target,
        metadata,
        content,
        updatedTime: now,
      });

      let committed = false;
      try {
        const saved = this.database.update(updated);
        committed = true;
        this.publish({ type: 'changed', attachment: saved });
        if (
          current.content &&
          current.content.ref.path !== saved.content?.ref.path
        ) {
          await this.removeContentAfterCommit(
            current.projectId,
            current.content.ref,
          );
        }
        return saved;
      } catch (error) {
        // Once the row is committed, the new ref is authoritative. In
        // particular, cleanup failure must not remove it or report a rollback.
        if (!committed) {
          await this.removeContentBestEffort(input.projectId, content.ref);
        }
        throw error;
      }
    });
  }

  async delete(projectId: string, attachmentId: string): Promise<void> {
    return this.enqueueMutation(attachmentId, async () => {
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
    });
  }

  async removeByAsset(projectId: string, assetId: string): Promise<void> {
    for (const attachment of this.database.listByAsset(projectId, assetId)) {
      await this.delete(projectId, attachment.id);
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
    const definition = this.targets.get(
      target.targetType,
      target.targetVersion,
    );
    if (!definition || !definition.isPayload(target.targetPayload)) {
      throw new AppError('ASSET_TARGET_INVALID');
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

  private enqueueMutation<T>(
    attachmentId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = attachmentId.trim();
    const previous = this.mutationTails.get(key) ?? Promise.resolve();
    const task = previous.then(operation, operation);
    const settled = task.then(
      () => undefined,
      () => undefined,
    );
    this.mutationTails.set(key, settled);
    void settled.then(
      () => {
        if (this.mutationTails.get(key) === settled) {
          this.mutationTails.delete(key);
        }
      },
      () => {
        if (this.mutationTails.get(key) === settled) {
          this.mutationTails.delete(key);
        }
      },
    );
    return task;
  }

  private async removeContentAfterCommit(
    projectId: string,
    ref: AssetAttachmentContent['ref'],
  ): Promise<void> {
    const key = this.contentCleanupKey(projectId, ref);
    try {
      await this.contentFiles.removeContent(projectId, ref);
      this.pendingContentCleanups.delete(key);
    } catch (error) {
      this.pendingContentCleanups.set(key, { projectId, ref });
      console.error('Attachment 旧内容文件清理已延期', error);
    }
  }

  private async removeContentBestEffort(
    projectId: string,
    ref: AssetAttachmentContent['ref'],
  ): Promise<void> {
    try {
      await this.contentFiles.removeContent(projectId, ref);
    } catch (cleanupError: unknown) {
      console.error('回滚 Attachment 新内容文件失败', cleanupError);
    }
  }

  private async retryPendingContentCleanups(): Promise<void> {
    for (const [key, pending] of [...this.pendingContentCleanups]) {
      try {
        await this.contentFiles.removeContent(pending.projectId, pending.ref);
        this.pendingContentCleanups.delete(key);
      } catch (error) {
        console.error('Attachment 延期内容文件清理失败', error);
      }
    }
  }

  private contentCleanupKey(
    projectId: string,
    ref: AssetAttachmentContent['ref'],
  ): string {
    return `${projectId}\u0000${ref.path}`;
  }
}
