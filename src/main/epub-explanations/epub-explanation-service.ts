import { randomUUID } from 'node:crypto';

import type { AssetLookup } from '../assets/asset-database';
import type { AttachmentFileManager } from '../attachments/attachment-file-manager';
import type {
  AttachmentServiceApi,
  AttachmentServiceEvent,
} from '../attachments/attachment-service';
import { AppError } from '../errors/app-error';
import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
} from '../generation/generation-task-service';
import {
  EPUB_EXPLANATION_ATTACHMENT_TYPE,
  EPUB_EXPLANATION_ATTACHMENT_VERSION,
  EPUB_EXPLANATION_INSTRUCTION_FORMAT,
  EPUB_EXPLANATION_INSTRUCTION_VERSION,
  EPUB_EXPLANATION_TASK_DEFINITION_ID,
  EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
  isEpubCfiRangeTarget,
  type CreateEpubExplanationRequest,
  type EpubExplanationEvent,
  type EpubExplanationIdRequest,
  type EpubExplanationStatus,
  type EpubExplanationView,
  type ListEpubExplanationsRequest,
} from '../../shared/epub-explanations';
import type { AssetAttachment } from '../../shared/workbench/attachment';
import type { JsonValue } from '../../shared/workbench/protocol';

interface EpubExplanationMetadata {
  readonly format: 'learning-companion/epub-explanation';
  readonly version: 1;
  readonly status: EpubExplanationStatus;
  readonly taskId?: string;
  readonly failureMessage?: string | null;
}

export type EpubExplanationListener = (
  event: EpubExplanationEvent,
) => void;

export interface EpubExplanationServiceApi {
  list(
    request: ListEpubExplanationsRequest,
  ): Promise<readonly EpubExplanationView[]>;
  create(
    request: CreateEpubExplanationRequest,
  ): Promise<EpubExplanationView>;
  retry(
    request: EpubExplanationIdRequest,
  ): Promise<EpubExplanationView>;
  delete(request: EpubExplanationIdRequest): Promise<void>;
  subscribe(listener: EpubExplanationListener): () => void;
  dispose(): void;
}

function metadataOf(attachment: AssetAttachment): EpubExplanationMetadata {
  const value: unknown = attachment.metadata;

  if (
    !isRecord(value) ||
    value.format !== 'learning-companion/epub-explanation' ||
    value.version !== 1 ||
    (value.status !== 'pending' &&
      value.status !== 'completed' &&
      value.status !== 'failed') ||
    (value.taskId !== undefined && typeof value.taskId !== 'string') ||
    (value.failureMessage !== undefined &&
      value.failureMessage !== null &&
      typeof value.failureMessage !== 'string')
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return value as unknown as EpubExplanationMetadata;
}

function createMetadata(input: {
  readonly status: EpubExplanationStatus;
  readonly taskId?: string;
  readonly failureMessage?: string | null;
}): JsonValue {
  return Object.freeze({
    format: 'learning-companion/epub-explanation',
    version: 1,
    status: input.status,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.failureMessage !== undefined
      ? { failureMessage: input.failureMessage }
      : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEpubExplanationAttachment(
  attachment: AssetAttachment,
): attachment is AssetAttachment & {
  readonly target: EpubExplanationView['target'];
} {
  return (
    attachment.typeId === EPUB_EXPLANATION_ATTACHMENT_TYPE &&
    attachment.typeVersion === EPUB_EXPLANATION_ATTACHMENT_VERSION &&
    isEpubCfiRangeTarget(attachment.target)
  );
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 1_000);
  }
  return 'AI 解释失败，请稍后重试。';
}

export class EpubExplanationService
  implements EpubExplanationServiceApi
{
  private readonly listeners = new Set<EpubExplanationListener>();
  private readonly removeAttachmentSubscription: () => void;
  private readonly removeGenerationSubscription: () => void;

  constructor(
    private readonly attachments: AttachmentServiceApi,
    private readonly files: AttachmentFileManager,
    private readonly generationTasks: GenerationTaskServiceApi,
    private readonly assets: AssetLookup,
    private readonly dependencies: {
      readonly createId: () => string;
      readonly now: () => number;
    } = { createId: randomUUID, now: Date.now },
  ) {
    this.removeAttachmentSubscription = attachments.subscribe((event) => {
      void this.handleAttachmentEvent(event);
    });
    this.removeGenerationSubscription = generationTasks.subscribe((event) => {
      void this.handleGenerationEvent(event);
    });
  }

  async list(
    request: ListEpubExplanationsRequest,
  ): Promise<readonly EpubExplanationView[]> {
    this.requireAsset(request.projectId, request.assetId);
    const attachments = await this.attachments.listByAsset(request.assetId);
    return Promise.all(
      attachments
        .filter(isEpubExplanationAttachment)
        .map((attachment) => this.toView(attachment)),
    );
  }

  async create(
    request: CreateEpubExplanationRequest,
  ): Promise<EpubExplanationView> {
    this.requireAsset(request.projectId, request.assetId);
    const duplicate = (await this.attachments.listByAsset(request.assetId)).find(
      (attachment) =>
        isEpubExplanationAttachment(attachment) &&
        attachment.target.anchorPayload.cfiRange ===
          request.target.anchorPayload.cfiRange,
    );
    if (duplicate) {
      return this.toView(duplicate);
    }

    const now = this.dependencies.now();
    const attachment: AssetAttachment = {
      id: this.dependencies.createId(),
      projectId: request.projectId,
      assetId: request.assetId,
      typeId: EPUB_EXPLANATION_ATTACHMENT_TYPE,
      typeVersion: EPUB_EXPLANATION_ATTACHMENT_VERSION,
      target: request.target,
      metadata: createMetadata({ status: 'pending' }),
      createdTime: now,
      updatedTime: now,
    };
    const created = await this.attachments.create(attachment);

    let taskId: string | undefined;

    try {
      const quote = request.target.anchorPayload.quote;
      const task = this.generationTasks.create({
        projectId: request.projectId,
        definitionId: EPUB_EXPLANATION_TASK_DEFINITION_ID,
        definitionVersion: EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
        instruction: {
          format: EPUB_EXPLANATION_INSTRUCTION_FORMAT,
          version: EPUB_EXPLANATION_INSTRUCTION_VERSION,
          attachmentId: created.id,
          exact: quote.exact,
          prefix: quote.prefix,
          suffix: quote.suffix,
        },
        assetReferences: {},
      });
      taskId = task.id;
      const updated = await this.attachments.update({
        ...created,
        metadata: createMetadata({
          status: 'pending',
          taskId: task.id,
        }),
        updatedTime: Math.max(this.dependencies.now(), created.updatedTime),
      });
      this.generationTasks.retry(task.id);
      return this.toView(updated);
    } catch (error) {
      if (taskId) {
        try {
          this.generationTasks.discard(taskId);
        } catch {
          // Best-effort compensation; the attachment is still removed below.
        }
      }
      await this.attachments.delete(created.id).catch(() => undefined);
      throw error;
    }
  }

  async retry(
    request: EpubExplanationIdRequest,
  ): Promise<EpubExplanationView> {
    const current = await this.requireExplanation(request);
    const metadata = metadataOf(current);

    if (!metadata.taskId) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const pending = await this.attachments.update({
      ...current,
      metadata: createMetadata({
        status: 'pending',
        taskId: metadata.taskId,
      }),
      updatedTime: Math.max(this.dependencies.now(), current.updatedTime),
    });

    try {
      this.generationTasks.retry(metadata.taskId);
    } catch (error) {
      await this.attachments.update({
        ...pending,
        metadata: createMetadata({
          status: 'failed',
          taskId: metadata.taskId,
          failureMessage: failureMessage(error),
        }),
        updatedTime: Math.max(this.dependencies.now(), pending.updatedTime),
      });
      throw error;
    }

    return this.toView(pending);
  }

  async delete(request: EpubExplanationIdRequest): Promise<void> {
    const current = await this.requireExplanation(request);
    const metadata = metadataOf(current);

    if (metadata.status !== 'completed' && metadata.taskId) {
      try {
        this.generationTasks.cancel(metadata.taskId);
      } catch {
        // The task may already have completed or been released.
      }
    }

    await this.files.delete(current.projectId, current.id);
    await this.attachments.delete(current.id);
  }

  subscribe(listener: EpubExplanationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.removeAttachmentSubscription();
    this.removeGenerationSubscription();
    this.listeners.clear();
  }

  private requireAsset(projectId: string, assetId: string): void {
    const asset = this.assets.get(projectId.trim(), assetId.trim());

    if (!asset || asset.mediaType !== 'application/epub+zip') {
      throw new AppError('ASSET_NOT_FOUND');
    }
    if (this.generationTasks.getActiveProjectId() !== projectId.trim()) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }
  }

  private async requireExplanation(
    request: EpubExplanationIdRequest,
  ): Promise<AssetAttachment> {
    this.requireAsset(request.projectId, request.assetId);
    const attachment = await this.attachments.get(request.explanationId);

    if (
      !attachment ||
      attachment.projectId !== request.projectId ||
      attachment.assetId !== request.assetId ||
      !isEpubExplanationAttachment(attachment)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return attachment;
  }

  private async toView(
    attachment: AssetAttachment,
  ): Promise<EpubExplanationView> {
    const metadata = metadataOf(attachment);
    const answer = attachment.content
      ? await this.files.readMarkdown(
          attachment.projectId,
          attachment.content.ref,
        )
      : undefined;

    return Object.freeze({
      id: attachment.id,
      projectId: attachment.projectId,
      assetId: attachment.assetId,
      target: attachment.target as EpubExplanationView['target'],
      status: metadata.status,
      ...(metadata.taskId ? { taskId: metadata.taskId } : {}),
      ...(answer !== undefined ? { answer } : {}),
      ...(typeof metadata.failureMessage === 'string'
        ? { failureMessage: metadata.failureMessage }
        : {}),
      createdTime: attachment.createdTime,
      updatedTime: attachment.updatedTime,
    });
  }

  private async handleAttachmentEvent(
    event: AttachmentServiceEvent,
  ): Promise<void> {
    if (event.type === 'deleted') {
      this.publish({
        type: 'deleted',
        projectId: event.projectId,
        assetId: event.assetId,
        explanationId: event.attachmentId,
      });
      return;
    }
    if (!isEpubExplanationAttachment(event.attachment)) {
      return;
    }

    const latest = await this.attachments.get(event.attachment.id);
    if (latest && isEpubExplanationAttachment(latest)) {
      this.publish({ type: 'changed', explanation: await this.toView(latest) });
    }
  }

  private async handleGenerationEvent(
    event: GenerationTaskServiceEvent,
  ): Promise<void> {
    if (event.type !== 'task-changed') {
      return;
    }
    const snapshot = event.snapshot;
    if (
      snapshot.definitionId !== EPUB_EXPLANATION_TASK_DEFINITION_ID ||
      (!snapshot.failure && snapshot.cancelledTime === undefined)
    ) {
      return;
    }
    const instruction: unknown = snapshot.instruction;
    if (
      !isRecord(instruction) ||
      instruction.format !== EPUB_EXPLANATION_INSTRUCTION_FORMAT ||
      typeof instruction.attachmentId !== 'string'
    ) {
      return;
    }
    const attachment = await this.attachments.get(instruction.attachmentId);
    if (!attachment || !isEpubExplanationAttachment(attachment)) {
      return;
    }
    const metadata = metadataOf(attachment);
    if (metadata.taskId !== snapshot.id || metadata.status === 'completed') {
      return;
    }

    await this.attachments.update({
      ...attachment,
      metadata: createMetadata({
        status: 'failed',
        taskId: snapshot.id,
        failureMessage: snapshot.failure?.message ?? 'AI 解释已取消。',
      }),
      updatedTime: Math.max(this.dependencies.now(), attachment.updatedTime),
    });
  }

  private publish(event: EpubExplanationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('发布 EPUB 解释事件失败', error);
      }
    }
  }
}
