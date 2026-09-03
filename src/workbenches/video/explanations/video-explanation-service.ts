import type { AssetLookup } from '../../../main/assets/asset-database';
import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import {
  WorkbenchConversationAttachmentProjection,
  type WorkbenchConversationProjectionLocation,
} from '../../../main/conversation/workbench-conversation-attachment-projection';
import {
  type WorkbenchConversationInstruction,
  workbenchConversationInstructionFactory,
} from '../../../main/conversation/workbench-conversation-instruction';
import { AppError } from '../../../main/errors/app-error';
import {
  GenerationTask,
  type GenerationTaskSnapshot,
} from '../../../main/generation/generation-task';
import type { GenerationTaskServiceApi } from '../../../main/generation/generation-task-service';
import type { AssetAttachment } from '../../../shared/attachments/contracts';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import {
  VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
  parseVideoConversationContext,
} from '../conversation/video-conversation-context';
import { isVideoFrameRegionTarget } from '../shared';
import {
  VIDEO_EXPLANATION_ATTACHMENT_TYPE,
  VIDEO_EXPLANATION_ATTACHMENT_VERSION,
  isVideoExplanationMetadata,
  type ListVideoExplanationsRequest,
  type VideoExplanationAttachmentView,
  type VideoExplanationEvent,
  type VideoExplanationIdRequest,
  type VideoExplanationMetadata,
  type VideoExplanationTaskView,
  type VideoExplanationView,
} from './shared';
import { isVideoExplanationForRevision } from './video-explanation-revision';

export type VideoExplanationListener = (
  event: VideoExplanationEvent,
) => void | Promise<void>;

export interface VideoExplanationServiceApi {
  list(
    request: ListVideoExplanationsRequest,
  ): Promise<readonly VideoExplanationView[]>;
  retry(request: VideoExplanationIdRequest): Promise<VideoExplanationView>;
  delete(request: VideoExplanationIdRequest): Promise<void>;
  subscribe(listener: VideoExplanationListener): () => void;
  dispose(): void;
}

function isSupportedVideo(mediaType: string): boolean {
  return mediaType.startsWith('video/');
}

type VideoExplanationAttachment = AssetAttachment & {
  readonly target: VideoExplanationAttachmentView['target'];
  readonly metadata: VideoExplanationMetadata;
};

function isExplanationAttachment(
  attachment: AssetAttachment,
): attachment is VideoExplanationAttachment {
  return (
    attachment.typeId === VIDEO_EXPLANATION_ATTACHMENT_TYPE &&
    attachment.typeVersion === VIDEO_EXPLANATION_ATTACHMENT_VERSION &&
    isVideoFrameRegionTarget(attachment.target) &&
    isVideoExplanationMetadata(attachment.metadata) &&
    attachment.content?.mediaType === 'text/markdown'
  );
}

export class VideoExplanationService implements VideoExplanationServiceApi {
  private readonly projection: WorkbenchConversationAttachmentProjection<
    VideoExplanationAttachment,
    VideoExplanationTaskView,
    VideoExplanationAttachmentView,
    VideoExplanationEvent
  >;

  constructor(
    private readonly attachments: AttachmentServiceApi,
    private readonly generationTasks: GenerationTaskServiceApi,
    private readonly assets: AssetLookup,
  ) {
    this.projection = new WorkbenchConversationAttachmentProjection<
      VideoExplanationAttachment,
      VideoExplanationTaskView,
      VideoExplanationAttachmentView,
      VideoExplanationEvent
    >(attachments, generationTasks, {
      label: '视频解释投影',
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
    request: ListVideoExplanationsRequest,
  ): Promise<readonly VideoExplanationView[]> {
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
        (view): view is VideoExplanationTaskView =>
          view !== undefined &&
          view.projectId === request.projectId &&
          view.assetId === request.assetId &&
          isVideoExplanationForRevision(view, request.sourceRevision),
      );
    for (const view of taskViews) {
      this.projection.trackTask(view);
    }
    return [...attachmentViews, ...taskViews].sort(
      (left, right) =>
        left.target.targetPayload.timeSeconds -
          right.target.targetPayload.timeSeconds ||
        left.createdTime - right.createdTime ||
        left.id.localeCompare(right.id),
    );
  }

  async retry(
    request: VideoExplanationIdRequest,
  ): Promise<VideoExplanationView> {
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

  async delete(request: VideoExplanationIdRequest): Promise<void> {
    if (request.kind === 'task') {
      const current = this.requireTask(request);
      if (current.status === 'failed') {
        this.generationTasks.discard(current.id);
      } else {
        this.generationTasks.cancel(current.id);
      }
      return;
    }
    const attachment = await this.requireAttachment(request);
    await this.attachments.delete(attachment.projectId, attachment.id);
  }

  subscribe(listener: VideoExplanationListener): () => void {
    return this.projection.subscribe(listener);
  }

  dispose(): void {
    this.projection.dispose();
  }

  private requireAsset(projectId: string, assetId: string): void {
    const asset = this.assets.get(projectId.trim(), assetId.trim());
    if (!asset || !isSupportedVideo(asset.mediaType)) {
      throw new AppError('ASSET_NOT_FOUND');
    }
    if (this.generationTasks.getActiveProjectId() !== projectId.trim()) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }
  }

  private requireTask(
    request: VideoExplanationIdRequest,
  ): VideoExplanationTaskView {
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

  private async requireAttachment(request: VideoExplanationIdRequest) {
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
      parsed.value.contextProviderId === VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID &&
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
      parseVideoConversationContext(instruction.context) !== undefined
      ? { projectId: snapshot.projectId, assetId: instruction.assetId }
      : undefined;
  }

  private toTaskView(
    snapshot: GenerationTaskSnapshot,
  ): VideoExplanationTaskView | undefined {
    const instruction = this.taskInstruction(snapshot);
    const conversationContext = parseVideoConversationContext(
      instruction?.context,
    );
    if (
      !instruction?.commitAnswer ||
      instruction.assetId === undefined ||
      !conversationContext
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
      sourceRevision: conversationContext.sourceRevision,
      question: instruction.question,
      conversationId: instruction.conversationId,
      status: status === 'failed' ? 'failed' : 'pending',
      ...(snapshot.failure ? { failureMessage: snapshot.failure.message } : {}),
      createdTime: snapshot.createdTime,
      updatedTime: snapshot.updatedTime,
    });
  }

  private async toAttachmentView(
    attachment: VideoExplanationAttachment,
  ): Promise<VideoExplanationAttachmentView> {
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
      sourceRevision: attachment.metadata.sourceRevision,
      question: attachment.metadata.question,
      ...(attachment.metadata.conversationId
        ? { conversationId: attachment.metadata.conversationId }
        : {}),
      status: 'completed',
      answer,
      createdTime: attachment.createdTime,
      updatedTime: attachment.updatedTime,
    });
  }
}
