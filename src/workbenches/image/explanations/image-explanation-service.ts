import { randomUUID } from 'node:crypto';

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
import type { AssetAttachment } from '../../../shared/attachments/contracts';
import {
  WorkbenchConversationInstruction,
  workbenchConversationInstructionFactory,
} from '../../../main/conversation/workbench-conversation-instruction';
import {
  WORKBENCH_CONVERSATION_SOURCE_SLOT,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import {
  createImageConversationContext,
  IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
  parseImageConversationContext,
} from './image-conversation-context';
import {
  IMAGE_EXPLANATION_ATTACHMENT_TYPE,
  IMAGE_EXPLANATION_ATTACHMENT_VERSION,
  IMAGE_DEFAULT_EXPLANATION_QUESTION,
  imageExplanationMarkerColor,
  isImageExplanationMetadata,
  isImageRegionTarget,
  type CreateImageExplanationRequest,
  type ImageExplanationAttachmentView,
  type ImageExplanationEvent,
  type ImageExplanationIdRequest,
  type ImageExplanationMetadata,
  type ImageExplanationTaskView,
  type ImageExplanationView,
  type ListImageExplanationsRequest,
  type UpdateImageExplanationMarkerColorRequest,
} from './shared';
import { isImageExplanationForRevision } from './image-explanation-revision';

export type ImageExplanationListener = (
  event: ImageExplanationEvent,
) => void | Promise<void>;

export interface ImageExplanationServiceApi {
  list(
    request: ListImageExplanationsRequest,
  ): Promise<readonly ImageExplanationView[]>;
  create(request: CreateImageExplanationRequest): Promise<ImageExplanationView>;
  retry(request: ImageExplanationIdRequest): Promise<ImageExplanationView>;
  delete(request: ImageExplanationIdRequest): Promise<void>;
  updateMarkerColor(
    request: UpdateImageExplanationMarkerColorRequest,
  ): Promise<ImageExplanationAttachmentView>;
  subscribe(listener: ImageExplanationListener): () => void;
  dispose(): void;
}

function isSupportedImage(mediaType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'].includes(
    mediaType,
  );
}

type ImageExplanationAttachment = AssetAttachment & {
  readonly target: ImageExplanationAttachmentView['target'];
  readonly metadata: ImageExplanationMetadata;
};

function isExplanationAttachment(
  attachment: AssetAttachment,
): attachment is ImageExplanationAttachment {
  return (
    attachment.typeId === IMAGE_EXPLANATION_ATTACHMENT_TYPE &&
    attachment.typeVersion === IMAGE_EXPLANATION_ATTACHMENT_VERSION &&
    isImageRegionTarget(attachment.target) &&
    isImageExplanationMetadata(attachment.metadata) &&
    attachment.content?.mediaType === 'text/markdown'
  );
}

function sameTarget(
  left: ImageExplanationView['target'],
  right: ImageExplanationView['target'],
): boolean {
  const a = left.targetPayload;
  const b = right.targetPayload;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.sourceWidth === b.sourceWidth &&
    a.sourceHeight === b.sourceHeight
  );
}

export class ImageExplanationService implements ImageExplanationServiceApi {
  private readonly projection: WorkbenchConversationAttachmentProjection<
    ImageExplanationAttachment,
    ImageExplanationTaskView,
    ImageExplanationAttachmentView,
    ImageExplanationEvent
  >;

  constructor(
    private readonly attachments: AttachmentServiceApi,
    private readonly generationTasks: GenerationTaskServiceApi,
    private readonly assets: AssetLookup,
  ) {
    this.projection = new WorkbenchConversationAttachmentProjection<
      ImageExplanationAttachment,
      ImageExplanationTaskView,
      ImageExplanationAttachmentView,
      ImageExplanationEvent
    >(attachments, generationTasks, {
      label: '图片解释投影',
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
    request: ListImageExplanationsRequest,
  ): Promise<readonly ImageExplanationView[]> {
    this.requireAsset(request.projectId, request.assetId);
    const attachmentViews = await Promise.all(
      (await this.attachments.listByAsset(request.projectId, request.assetId))
        .filter(isExplanationAttachment)
        .filter(
          (attachment) =>
            attachment.metadata.sourceRevision === request.sourceRevision,
        )
        .map((attachment) => this.toAttachmentView(attachment)),
    );
    const taskViews = this.generationTasks
      .list()
      .map((snapshot) => this.toTaskView(snapshot))
      .filter(
        (view): view is ImageExplanationTaskView =>
          view !== undefined &&
          view.projectId === request.projectId &&
          view.assetId === request.assetId &&
          isImageExplanationForRevision(view, request.sourceRevision),
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
    request: CreateImageExplanationRequest,
  ): Promise<ImageExplanationView> {
    this.requireAsset(request.projectId, request.assetId);
    const existingAttachment = (
      await this.attachments.listByAsset(request.projectId, request.assetId)
    )
      .filter(isExplanationAttachment)
      .find(
        (attachment) =>
          attachment.metadata.sourceRevision === request.sourceRevision &&
          sameTarget(attachment.target, request.target),
      );
    if (existingAttachment) return this.toAttachmentView(existingAttachment);

    const existingTask = this.generationTasks
      .list()
      .map((snapshot) => this.toTaskView(snapshot))
      .find(
        (view) =>
          view?.projectId === request.projectId &&
          view.assetId === request.assetId &&
          isImageExplanationForRevision(view, request.sourceRevision) &&
          sameTarget(view.target, request.target),
      );
    if (existingTask) return existingTask;

    const instruction = new WorkbenchConversationInstruction({
      contextProviderId: IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
      assetId: request.assetId,
      conversationId: randomUUID(),
      question: IMAGE_DEFAULT_EXPLANATION_QUESTION,
      context: createImageConversationContext(
        request.target,
        request.sourceRevision,
      ),
      commitAnswer: true,
    });
    const task = this.generationTasks.start({
      projectId: request.projectId,
      definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
      definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      instruction: instruction.toSnapshot(),
      assetReferences: {
        [WORKBENCH_CONVERSATION_SOURCE_SLOT]: [{ assetId: request.assetId }],
      },
    });
    const view = this.toTaskView(task);
    if (!view) throw new AppError('DATA_INTEGRITY_ERROR');
    this.projection.trackTask(view);
    return view;
  }

  async retry(
    request: ImageExplanationIdRequest,
  ): Promise<ImageExplanationView> {
    if (request.kind !== 'task') throw new AppError('OPERATION_SUPERSEDED');
    const current = this.requireTask(request);
    if (current.status !== 'failed') throw new AppError('OPERATION_SUPERSEDED');
    const retried = this.toTaskView(
      this.generationTasks.retry(request.explanationId),
    );
    if (!retried) throw new AppError('DATA_INTEGRITY_ERROR');
    this.projection.trackTask(retried);
    return retried;
  }

  async delete(request: ImageExplanationIdRequest): Promise<void> {
    if (request.kind === 'task') {
      const current = this.requireTask(request);
      if (current.status === 'failed') this.generationTasks.discard(current.id);
      else this.generationTasks.cancel(current.id);
      return;
    }
    const attachment = await this.requireAttachment(request);
    await this.attachments.delete(attachment.projectId, attachment.id);
  }

  async updateMarkerColor(
    request: UpdateImageExplanationMarkerColorRequest,
  ): Promise<ImageExplanationAttachmentView> {
    const current = await this.requireAttachment({
      projectId: request.projectId,
      assetId: request.assetId,
      kind: 'attachment',
      explanationId: request.explanationId,
    });
    if (current.metadata.sourceRevision !== request.sourceRevision) {
      throw new AppError('OPERATION_SUPERSEDED');
    }
    const updated = await this.attachments.update({
      projectId: current.projectId,
      attachmentId: current.id,
      metadata: {
        format: 'learning-companion/image-explanation',
        version: 1,
        sourceRevision: current.metadata.sourceRevision,
        markerColor: request.markerColor,
      },
    });
    if (!isExplanationAttachment(updated)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    return this.toAttachmentView(updated);
  }

  subscribe(listener: ImageExplanationListener): () => void {
    return this.projection.subscribe(listener);
  }

  dispose(): void {
    this.projection.dispose();
  }

  private requireAsset(projectId: string, assetId: string): void {
    const asset = this.assets.get(projectId.trim(), assetId.trim());
    if (!asset || !isSupportedImage(asset.mediaType))
      throw new AppError('ASSET_NOT_FOUND');
    if (this.generationTasks.getActiveProjectId() !== projectId.trim()) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }
  }

  private requireTask(
    request: ImageExplanationIdRequest,
  ): ImageExplanationTaskView {
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

  private async requireAttachment(request: ImageExplanationIdRequest) {
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
    )
      return undefined;
    const parsed = workbenchConversationInstructionFactory.parse(
      snapshot.instruction,
    );
    return parsed.ok &&
      parsed.value.contextProviderId === IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID &&
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
      parseImageConversationContext(instruction.context) !== undefined
      ? { projectId: snapshot.projectId, assetId: instruction.assetId }
      : undefined;
  }

  private toTaskView(
    snapshot: GenerationTaskSnapshot,
  ): ImageExplanationTaskView | undefined {
    const instruction = this.taskInstruction(snapshot);
    const conversationContext = parseImageConversationContext(
      instruction?.context,
    );
    if (
      !instruction?.commitAnswer ||
      instruction.assetId === undefined ||
      !conversationContext
    )
      return undefined;
    const status = new GenerationTask(snapshot).getStatus();
    if (status === 'completed' || status === 'cancelled') return undefined;
    const sourceRevision =
      conversationContext.sourceRevision ??
      snapshot.prepared?.assetReferences.source?.[0]?.contentRevision;
    return Object.freeze({
      kind: 'task',
      id: snapshot.id,
      projectId: snapshot.projectId,
      assetId: instruction.assetId,
      target: conversationContext.target,
      status: status === 'failed' ? 'failed' : 'pending',
      ...(sourceRevision ? { sourceRevision } : {}),
      ...(snapshot.failure ? { failureMessage: snapshot.failure.message } : {}),
      createdTime: snapshot.createdTime,
      updatedTime: snapshot.updatedTime,
    });
  }

  private async toAttachmentView(
    attachment: ImageExplanationAttachment,
  ): Promise<ImageExplanationAttachmentView> {
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
      sourceRevision: attachment.metadata.sourceRevision,
      markerColor: imageExplanationMarkerColor(attachment.metadata),
      createdTime: attachment.createdTime,
      updatedTime: attachment.updatedTime,
    });
  }
}
