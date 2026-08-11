import type { AssetAttachment } from '../../../shared/attachments/contracts';
import type { AssetLookup } from '../../../main/assets/asset-database';
import type { AttachmentContentFile } from '../../../main/attachments/attachment-content-file';
import type {
  AttachmentServiceApi,
  AttachmentServiceEvent,
} from '../../../main/attachments/attachment-service';
import { AppError } from '../../../main/errors/app-error';
import {
  GenerationTask,
  type GenerationTaskSnapshot,
} from '../../../main/generation/generation-task';
import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
} from '../../../main/generation/generation-task-service';
import {
  EPUB_EXPLANATION_ATTACHMENT_TYPE,
  EPUB_EXPLANATION_ATTACHMENT_VERSION,
  EPUB_EXPLANATION_TASK_DEFINITION_ID,
  EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
  isEpubCfiRangeTarget,
  isEpubExplanationMetadata,
  type CreateEpubExplanationRequest,
  type EpubExplanationAttachmentView,
  type EpubExplanationEvent,
  type EpubExplanationIdRequest,
  type EpubExplanationTaskView,
  type EpubExplanationView,
  type ListEpubExplanationsRequest,
} from './shared';
import {
  EpubExplanationInstruction,
  epubExplanationInstructionFactory,
} from './generation/instruction';

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

function isExplanationAttachment(
  attachment: AssetAttachment,
): attachment is AssetAttachment & {
  readonly target: EpubExplanationAttachmentView['target'];
} {
  return (
    attachment.typeId === EPUB_EXPLANATION_ATTACHMENT_TYPE &&
    attachment.typeVersion === EPUB_EXPLANATION_ATTACHMENT_VERSION &&
    isEpubCfiRangeTarget(attachment.target) &&
    isEpubExplanationMetadata(attachment.metadata) &&
    attachment.content?.mediaType === 'text/markdown'
  );
}

function sameTarget(
  left: EpubExplanationView['target'],
  right: EpubExplanationView['target'],
): boolean {
  return left.anchorPayload.cfiRange === right.anchorPayload.cfiRange;
}

function resultAttachmentId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const attachmentId = Reflect.get(value, 'attachmentId');
  return typeof attachmentId === 'string' && attachmentId.trim().length > 0
    ? attachmentId
    : undefined;
}

export class EpubExplanationService implements EpubExplanationServiceApi {
  private readonly listeners = new Set<EpubExplanationListener>();
  private readonly taskLocations = new Map<
    string,
    { readonly projectId: string; readonly assetId: string }
  >();
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
    const attachmentViews = await Promise.all(
      (
        await this.attachments.listByAsset(
          request.projectId,
          request.assetId,
        )
      )
        .filter(isExplanationAttachment)
        .map((attachment) => this.toAttachmentView(attachment)),
    );
    const taskViews = this.generationTasks
      .list()
      .map((snapshot) => this.toTaskView(snapshot))
      .filter(
        (view): view is EpubExplanationTaskView =>
          view !== undefined &&
          view.projectId === request.projectId &&
          view.assetId === request.assetId,
      );

    for (const view of taskViews) {
      this.taskLocations.set(view.id, {
        projectId: view.projectId,
        assetId: view.assetId,
      });
    }

    return [...attachmentViews, ...taskViews].sort(
      (left, right) =>
        left.createdTime - right.createdTime || left.id.localeCompare(right.id),
    );
  }

  async create(
    request: CreateEpubExplanationRequest,
  ): Promise<EpubExplanationView> {
    this.requireAsset(request.projectId, request.assetId);
    const existingAttachment = (
      await this.attachments.listByAsset(request.projectId, request.assetId)
    )
      .filter(isExplanationAttachment)
      .find((attachment) => sameTarget(attachment.target, request.target));
    if (existingAttachment) {
      return this.toAttachmentView(existingAttachment);
    }

    const existingTask = this.generationTasks
      .list()
      .map((snapshot) => this.toTaskView(snapshot))
      .find(
        (view) =>
          view?.projectId === request.projectId &&
          view.assetId === request.assetId &&
          sameTarget(view.target, request.target),
      );
    if (existingTask) return existingTask;

    const instruction = new EpubExplanationInstruction({
      assetId: request.assetId,
      target: request.target,
    });
    const task = this.generationTasks.start({
      projectId: request.projectId,
      definitionId: EPUB_EXPLANATION_TASK_DEFINITION_ID,
      definitionVersion: EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
      instruction: instruction.toSnapshot(),
      assetReferences: {},
    });
    const view = this.toTaskView(task);
    if (!view) throw new AppError('DATA_INTEGRITY_ERROR');
    this.taskLocations.set(view.id, {
      projectId: view.projectId,
      assetId: view.assetId,
    });
    return view;
  }

  async retry(request: EpubExplanationIdRequest): Promise<EpubExplanationView> {
    if (request.kind !== 'task') {
      throw new AppError('OPERATION_SUPERSEDED');
    }
    const current = this.requireTask(request);
    if (current.status !== 'failed') {
      throw new AppError('OPERATION_SUPERSEDED');
    }
    const retried = this.toTaskView(
      this.generationTasks.retry(request.explanationId),
    );
    if (!retried) throw new AppError('DATA_INTEGRITY_ERROR');
    return retried;
  }

  async delete(request: EpubExplanationIdRequest): Promise<void> {
    if (request.kind === 'task') {
      const current = this.requireTask(request);
      if (current.status === 'failed') {
        this.generationTasks.discard(current.id);
      } else {
        this.generationTasks.cancel(current.id);
      }
      return;
    }

    const current = await this.requireAttachment(request);
    await this.attachments.delete(current.projectId, current.id);
  }

  subscribe(listener: EpubExplanationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.removeAttachmentSubscription();
    this.removeGenerationSubscription();
    this.taskLocations.clear();
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

  private requireTask(request: EpubExplanationIdRequest): EpubExplanationTaskView {
    this.requireAsset(request.projectId, request.assetId);
    const snapshot = this.generationTasks.get(request.explanationId);
    const view = snapshot ? this.toTaskView(snapshot) : undefined;
    if (
      !view ||
      view.projectId !== request.projectId ||
      view.assetId !== request.assetId
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    return view;
  }

  private async requireAttachment(
    request: EpubExplanationIdRequest,
  ): Promise<AssetAttachment & {
    readonly target: EpubExplanationAttachmentView['target'];
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

  private taskInstruction(
    snapshot: GenerationTaskSnapshot,
  ): EpubExplanationInstruction | undefined {
    if (
      snapshot.definitionId !== EPUB_EXPLANATION_TASK_DEFINITION_ID ||
      snapshot.definitionVersion !==
        EPUB_EXPLANATION_TASK_DEFINITION_VERSION
    ) {
      return undefined;
    }
    const parsed = epubExplanationInstructionFactory.parse(
      snapshot.instruction,
    );
    return parsed.ok ? parsed.value : undefined;
  }

  private toTaskView(
    snapshot: GenerationTaskSnapshot,
  ): EpubExplanationTaskView | undefined {
    const instruction = this.taskInstruction(snapshot);
    if (!instruction) return undefined;
    const status = new GenerationTask(snapshot).getStatus();
    if (status === 'completed' || status === 'cancelled') return undefined;
    return Object.freeze({
      kind: 'task',
      id: snapshot.id,
      projectId: snapshot.projectId,
      assetId: instruction.assetId,
      target: instruction.target,
      status: status === 'failed' ? 'failed' : 'pending',
      ...(snapshot.failure
        ? { failureMessage: snapshot.failure.message }
        : {}),
      createdTime: snapshot.createdTime,
      updatedTime: snapshot.updatedTime,
    });
  }

  private async toAttachmentView(
    attachment: AssetAttachment & {
      readonly target: EpubExplanationAttachmentView['target'];
    },
  ): Promise<EpubExplanationAttachmentView> {
    if (!attachment.content) throw new AppError('DATA_INTEGRITY_ERROR');
    const answer = await this.contentFiles.readText(
      attachment.projectId,
      attachment.content.ref,
    );
    if (answer === undefined) throw new AppError('DATA_INTEGRITY_ERROR');
    return Object.freeze({
      kind: 'attachment',
      id: attachment.id,
      projectId: attachment.projectId,
      assetId: attachment.assetId,
      target: attachment.target,
      status: 'completed',
      answer,
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
      explanation: await this.toAttachmentView(event.attachment),
    });
  }

  private async handleGenerationEvent(
    event: GenerationTaskServiceEvent,
  ): Promise<void> {
    if (event.type === 'execution-event') return;
    if (event.type === 'task-discarded') {
      const location = this.taskLocations.get(event.taskId);
      if (!location) return;
      this.taskLocations.delete(event.taskId);
      this.publish({
        type: 'deleted',
        ...location,
        explanationId: event.taskId,
      });
      return;
    }

    const instruction = this.taskInstruction(event.snapshot);
    if (!instruction) return;
    const location = {
      projectId: event.snapshot.projectId,
      assetId: instruction.assetId,
    };
    this.taskLocations.set(event.snapshot.id, location);

    if (event.type === 'task-completed') {
      this.taskLocations.delete(event.snapshot.id);
      const attachmentId = resultAttachmentId(event.result.result);
      const attachment = attachmentId
        ? await this.attachments.get(attachmentId)
        : undefined;
      if (
        !attachment ||
        attachment.projectId !== location.projectId ||
        attachment.assetId !== location.assetId ||
        !isExplanationAttachment(attachment)
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      this.publish({
        type: 'replaced',
        ...location,
        previousExplanationId: event.snapshot.id,
        explanation: await this.toAttachmentView(attachment),
      });
      return;
    }

    const status = new GenerationTask(event.snapshot).getStatus();
    if (status === 'completed') {
      // task-completed carries the result Attachment ID and performs the
      // renderer projection replacement atomically.
      return;
    }
    const view = this.toTaskView(event.snapshot);
    if (!view) {
      this.taskLocations.delete(event.snapshot.id);
      this.publish({
        type: 'deleted',
        ...location,
        explanationId: event.snapshot.id,
      });
      return;
    }
    this.publish({ type: 'changed', explanation: view });
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
