import { randomUUID } from 'node:crypto';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import type { AssetLookup } from '../../../main/assets/asset-database';
import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import {
  WorkbenchConversationAttachmentProjection,
  type WorkbenchConversationProjectionLocation,
} from '../../../main/conversation/workbench-conversation-attachment-projection';
import { AppError } from '../../../main/errors/app-error';
import {
  GenerationTask,
  type GenerationTaskSnapshot,
} from '../../../main/generation/generation-task';
import type { GenerationTaskServiceApi } from '../../../main/generation/generation-task-service';
import {
  EPUB_DEFAULT_EXPLANATION_QUESTION,
  EPUB_EXPLANATION_ATTACHMENT_TYPE,
  EPUB_EXPLANATION_ATTACHMENT_VERSION,
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
  WorkbenchConversationInstruction,
  workbenchConversationInstructionFactory,
} from '../../../main/conversation/workbench-conversation-instruction';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import {
  createEpubConversationContext,
  EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
  isEpubConversationContext,
} from './epub-conversation-context';

export type EpubExplanationListener = (
  event: EpubExplanationEvent,
) => void | Promise<void>;

export interface EpubExplanationServiceApi {
  list(
    request: ListEpubExplanationsRequest,
  ): Promise<readonly EpubExplanationView[]>;
  create(request: CreateEpubExplanationRequest): Promise<EpubExplanationView>;
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

export class EpubExplanationService implements EpubExplanationServiceApi {
  private readonly projection: WorkbenchConversationAttachmentProjection<
    AssetAttachment & {
      readonly target: EpubExplanationAttachmentView['target'];
    },
    EpubExplanationTaskView,
    EpubExplanationAttachmentView,
    EpubExplanationEvent
  >;

  constructor(
    private readonly attachments: AttachmentServiceApi,
    private readonly generationTasks: GenerationTaskServiceApi,
    private readonly assets: AssetLookup,
  ) {
    this.projection = new WorkbenchConversationAttachmentProjection<
      AssetAttachment & {
        readonly target: EpubExplanationAttachmentView['target'];
      },
      EpubExplanationTaskView,
      EpubExplanationAttachmentView,
      EpubExplanationEvent
    >(attachments, generationTasks, {
      label: 'EPUB 解释投影',
      isAttachment: isExplanationAttachment,
      locateTask: (snapshot) => this.taskLocation(snapshot),
      toTaskView: (snapshot) => this.toTaskView(snapshot),
      toAttachmentView: (attachment) => this.toAttachmentView(attachment),
      events: {
        changed: (explanation) => ({ type: 'changed', explanation }),
        replaced: (location, previousExplanationId, explanation) => ({
          type: 'replaced',
          ...location,
          previousExplanationId,
          explanation,
        }),
        deleted: (location, explanationId) => ({
          type: 'deleted',
          ...location,
          explanationId,
        }),
      },
    });
  }

  async list(
    request: ListEpubExplanationsRequest,
  ): Promise<readonly EpubExplanationView[]> {
    this.requireAsset(request.projectId, request.assetId);
    const attachmentViews = await Promise.all(
      (await this.attachments.listByAsset(request.projectId, request.assetId))
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
      this.projection.trackTask(view);
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

    const instruction = new WorkbenchConversationInstruction({
      contextProviderId: EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
      assetId: request.assetId,
      conversationId: randomUUID(),
      question: EPUB_DEFAULT_EXPLANATION_QUESTION,
      context: createEpubConversationContext(request.target),
      commitAnswer: true,
    });
    const task = this.generationTasks.start({
      projectId: request.projectId,
      definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
      definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      instruction: instruction.toSnapshot(),
      assetReferences: {},
    });
    const view = this.toTaskView(task);
    if (!view) throw new AppError('DATA_INTEGRITY_ERROR');
    this.projection.trackTask(view);
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
    this.projection.trackTask(retried);
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
    return this.projection.subscribe(listener);
  }

  dispose(): void {
    this.projection.dispose();
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

  private requireTask(
    request: EpubExplanationIdRequest,
  ): EpubExplanationTaskView {
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

  private async requireAttachment(request: EpubExplanationIdRequest): Promise<
    AssetAttachment & {
      readonly target: EpubExplanationAttachmentView['target'];
    }
  > {
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
  ): WorkbenchConversationInstruction | undefined {
    if (
      snapshot.definitionId !== WORKBENCH_CONVERSATION_TASK_DEFINITION_ID ||
      snapshot.definitionVersion !==
        WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION
    ) {
      return undefined;
    }
    const parsed = workbenchConversationInstructionFactory.parse(
      snapshot.instruction,
    );
    return parsed.ok &&
      parsed.value.contextProviderId === EPUB_CONVERSATION_CONTEXT_PROVIDER_ID &&
      parsed.value.assetId !== undefined
      ? parsed.value
      : undefined;
  }

  private taskLocation(
    snapshot: GenerationTaskSnapshot,
  ): WorkbenchConversationProjectionLocation | undefined {
    const instruction = this.taskInstruction(snapshot);
    return instruction?.commitAnswer &&
      instruction.assetId !== undefined &&
      isEpubConversationContext(instruction.context)
      ? { projectId: snapshot.projectId, assetId: instruction.assetId }
      : undefined;
  }

  private toTaskView(
    snapshot: GenerationTaskSnapshot,
  ): EpubExplanationTaskView | undefined {
    const instruction = this.taskInstruction(snapshot);
    const conversationContext = instruction?.context;
    if (
      !instruction?.commitAnswer ||
      instruction.assetId === undefined ||
      !isEpubConversationContext(conversationContext)
    ) {
      return undefined;
    }
    const status = new GenerationTask(snapshot).getStatus();
    if (status === 'completed' || status === 'cancelled') return undefined;
    return Object.freeze({
      kind: 'task',
      id: snapshot.id,
      projectId: snapshot.projectId,
      assetId: instruction.assetId,
      target: conversationContext.target,
      status: status === 'failed' ? 'failed' : 'pending',
      ...(snapshot.failure ? { failureMessage: snapshot.failure.message } : {}),
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
    const answer = await this.attachments.readTextContent(
      attachment.projectId,
      attachment.id,
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
}
