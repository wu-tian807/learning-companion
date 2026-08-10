import type { AssetAttachment } from '../../../shared/attachments/contracts';
import type { JsonValue } from '../../../shared/workbench/protocol';
import type { AssetLookup } from '../../../main/assets/asset-database';
import type { AttachmentContentFile } from '../../../main/attachments/attachment-content-file';
import type {
  AttachmentServiceApi,
  AttachmentServiceEvent,
} from '../../../main/attachments/attachment-service';
import { AppError } from '../../../main/errors/app-error';
import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
} from '../../../main/generation/generation-task-service';
import {
  EPUB_EXPLANATION_ATTACHMENT_TYPE,
  EPUB_EXPLANATION_ATTACHMENT_VERSION,
  EPUB_EXPLANATION_INSTRUCTION_FORMAT,
  EPUB_EXPLANATION_INSTRUCTION_VERSION,
  EPUB_EXPLANATION_TASK_DEFINITION_ID,
  EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
  isEpubCfiRangeTarget,
  isEpubExplanationMetadata,
  type CreateEpubExplanationRequest,
  type EpubExplanationEvent,
  type EpubExplanationIdRequest,
  type EpubExplanationMetadata,
  type EpubExplanationStatus,
  type EpubExplanationView,
  type ListEpubExplanationsRequest,
} from './shared';

export type EpubExplanationListener = (
  event: EpubExplanationEvent,
) => void | Promise<void>;

export interface EpubExplanationServiceApi {
  list(
    request: ListEpubExplanationsRequest,
  ): Promise<readonly EpubExplanationView[]>;
  create(
    request: CreateEpubExplanationRequest,
  ): Promise<EpubExplanationView>;
  retry(request: EpubExplanationIdRequest): Promise<EpubExplanationView>;
  delete(request: EpubExplanationIdRequest): Promise<void>;
  subscribe(listener: EpubExplanationListener): () => void;
  dispose(): void;
}

function metadata(input: {
  readonly status: EpubExplanationStatus;
  readonly taskId?: string;
  readonly failureMessage?: string | null;
}): JsonValue & EpubExplanationMetadata {
  return Object.freeze({
    format: 'learning-companion/epub-explanation' as const,
    version: 1 as const,
    status: input.status,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.failureMessage !== undefined
      ? { failureMessage: input.failureMessage }
      : {}),
  });
}

function isExplanationAttachment(
  attachment: AssetAttachment,
): attachment is AssetAttachment & {
  readonly target: EpubExplanationView['target'];
  readonly metadata: JsonValue & EpubExplanationMetadata;
} {
  return (
    attachment.typeId === EPUB_EXPLANATION_ATTACHMENT_TYPE &&
    attachment.typeVersion === EPUB_EXPLANATION_ATTACHMENT_VERSION &&
    isEpubCfiRangeTarget(attachment.target) &&
    isEpubExplanationMetadata(attachment.metadata)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class EpubExplanationService implements EpubExplanationServiceApi {
  private readonly listeners = new Set<EpubExplanationListener>();
  private readonly removeAttachmentSubscription: () => void;
  private readonly removeGenerationSubscription: () => void;

  constructor(
    private readonly attachments: AttachmentServiceApi,
    private readonly contentFiles: AttachmentContentFile,
    private readonly generationTasks: GenerationTaskServiceApi,
    private readonly assets: AssetLookup,
  ) {
    this.removeAttachmentSubscription = attachments.subscribe((event) =>
      this.handleAttachmentEvent(event),
    );
    this.removeGenerationSubscription = generationTasks.subscribe((event) => {
      void this.handleGenerationEvent(event).catch((error: unknown) => {
        console.error('同步 EPUB 解释任务状态失败', error);
      });
    });
  }

  async list(
    request: ListEpubExplanationsRequest,
  ): Promise<readonly EpubExplanationView[]> {
    this.requireAsset(request.projectId, request.assetId);
    const attachments = await this.attachments.listByAsset(
      request.projectId,
      request.assetId,
    );
    return Promise.all(
      attachments
        .filter(isExplanationAttachment)
        .map((attachment) => this.toView(attachment)),
    );
  }

  async create(
    request: CreateEpubExplanationRequest,
  ): Promise<EpubExplanationView> {
    this.requireAsset(request.projectId, request.assetId);
    const existing = (
      await this.attachments.listByAsset(request.projectId, request.assetId)
    ).filter(isExplanationAttachment).find(
      (attachment) =>
        attachment.target.anchorPayload.cfiRange ===
          request.target.anchorPayload.cfiRange,
    );
    if (existing) return this.toView(existing);

    const attachment = await this.attachments.create({
      projectId: request.projectId,
      assetId: request.assetId,
      typeId: EPUB_EXPLANATION_ATTACHMENT_TYPE,
      typeVersion: EPUB_EXPLANATION_ATTACHMENT_VERSION,
      target: request.target,
      metadata: metadata({ status: 'pending' }),
    });

    try {
      if (!isExplanationAttachment(attachment)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      return await this.startFreshTask(attachment);
    } catch (error) {
      await this.attachments
        .delete(attachment.projectId, attachment.id)
        .catch(() => undefined);
      throw error;
    }
  }

  async retry(request: EpubExplanationIdRequest): Promise<EpubExplanationView> {
    return this.startFreshTask(await this.requireExplanation(request));
  }

  async delete(request: EpubExplanationIdRequest): Promise<void> {
    const current = await this.requireExplanation(request);
    const taskId = current.metadata.taskId;
    if (current.metadata.status !== 'completed' && taskId) {
      try {
        this.generationTasks.cancel(taskId);
      } catch {
        // The failed task may already be outside the active in-memory set.
      }
    }
    await this.attachments.delete(current.projectId, current.id);
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

  private async startFreshTask(
    attachment: AssetAttachment & {
      readonly target: EpubExplanationView['target'];
    },
  ): Promise<EpubExplanationView> {
    const quote = attachment.target.anchorPayload.quote;
    const task = this.generationTasks.create({
      projectId: attachment.projectId,
      definitionId: EPUB_EXPLANATION_TASK_DEFINITION_ID,
      definitionVersion: EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
      instruction: {
        format: EPUB_EXPLANATION_INSTRUCTION_FORMAT,
        version: EPUB_EXPLANATION_INSTRUCTION_VERSION,
        attachmentId: attachment.id,
        exact: quote.exact,
        prefix: quote.prefix,
        suffix: quote.suffix,
      },
      assetReferences: {},
    });

    try {
      const pending = await this.attachments.update({
        projectId: attachment.projectId,
        attachmentId: attachment.id,
        metadata: metadata({ status: 'pending', taskId: task.id }),
        content: null,
      });
      this.generationTasks.retry(task.id);
      if (!isExplanationAttachment(pending)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      return this.toView(pending);
    } catch (error) {
      try {
        this.generationTasks.discard(task.id);
      } catch {
        // Best-effort compensation for a task that did not start.
      }
      throw error;
    }
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
  ): Promise<AssetAttachment & {
    readonly target: EpubExplanationView['target'];
    readonly metadata: JsonValue & EpubExplanationMetadata;
  }> {
    this.requireAsset(request.projectId, request.assetId);
    const attachment = await this.attachments.get(request.explanationId);
    if (
      !attachment ||
      attachment.projectId !== request.projectId ||
      attachment.assetId !== request.assetId ||
      !isExplanationAttachment(attachment)
    ) {
      throw new AppError('ATTACHMENT_NOT_FOUND');
    }
    return attachment;
  }

  private async toView(
    attachment: AssetAttachment & {
      readonly target: EpubExplanationView['target'];
      readonly metadata: JsonValue & EpubExplanationMetadata;
    },
  ): Promise<EpubExplanationView> {
    const answer = attachment.content
      ? await this.contentFiles.readText(
          attachment.projectId,
          attachment.content.ref,
        )
      : undefined;
    return Object.freeze({
      id: attachment.id,
      projectId: attachment.projectId,
      assetId: attachment.assetId,
      target: attachment.target,
      status: attachment.metadata.status,
      ...(attachment.metadata.taskId
        ? { taskId: attachment.metadata.taskId }
        : {}),
      ...(answer === undefined ? {} : { answer }),
      ...(typeof attachment.metadata.failureMessage === 'string'
        ? { failureMessage: attachment.metadata.failureMessage }
        : {}),
      createdTime: attachment.createdTime,
      updatedTime: attachment.updatedTime,
    });
  }

  private async handleAttachmentEvent(
    event: AttachmentServiceEvent,
  ): Promise<void> {
    if (!isExplanationAttachment(event.attachment)) return;
    if (event.type === 'deleted') {
      this.publish({
        type: 'deleted',
        projectId: event.attachment.projectId,
        assetId: event.attachment.assetId,
        explanationId: event.attachment.id,
      });
      return;
    }
    this.publish({
      type: 'changed',
      explanation: await this.toView(event.attachment),
    });
  }

  private async handleGenerationEvent(
    event: GenerationTaskServiceEvent,
  ): Promise<void> {
    if (event.type !== 'task-changed') return;
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
    if (!attachment || !isExplanationAttachment(attachment)) return;
    if (
      attachment.metadata.taskId !== snapshot.id ||
      attachment.metadata.status === 'completed'
    ) {
      return;
    }
    await this.attachments.update({
      projectId: attachment.projectId,
      attachmentId: attachment.id,
      metadata: metadata({
        status: 'failed',
        taskId: snapshot.id,
        failureMessage:
          snapshot.failure?.message ?? 'AI 解释已取消，请重试。',
      }),
    });
  }

  private publish(event: EpubExplanationEvent): void {
    for (const listener of this.listeners) {
      try {
        Promise.resolve(listener(event)).catch((error: unknown) => {
          console.error('异步 EPUB 解释订阅者执行失败', error);
        });
      } catch (error) {
        console.error('发布 EPUB 解释事件失败', error);
      }
    }
  }
}
