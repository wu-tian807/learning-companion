import type { AssetLookup } from '../../../main/assets/asset-database';
import type { AttachmentContentFile } from '../../../main/attachments/attachment-content-file';
import type {
  AttachmentServiceApi,
  AttachmentServiceEvent,
} from '../../../main/attachments/attachment-service';
import {
  type WorkbenchConversationInstruction,
  workbenchConversationInstructionFactory,
} from '../../../main/conversation/workbench-conversation-instruction';
import { AppError } from '../../../main/errors/app-error';
import {
  GenerationTask,
  type GenerationTaskSnapshot,
} from '../../../main/generation/generation-task';
import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
} from '../../../main/generation/generation-task-service';
import type { AssetAttachment } from '../../../shared/attachments/contracts';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
  isWorkbenchConversationTaskResult,
} from '../../../shared/workbench-conversation';
import {
  VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
  isVideoConversationContext,
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

function resultAttachmentId(value: unknown): string | undefined {
  if (!isWorkbenchConversationTaskResult(value)) return undefined;
  const contextResult = value.contextResult;
  if (
    typeof contextResult !== 'object' ||
    contextResult === null ||
    Array.isArray(contextResult)
  ) {
    return undefined;
  }
  const attachmentId = Reflect.get(contextResult, 'attachmentId');
  return typeof attachmentId === 'string' && attachmentId.trim()
    ? attachmentId
    : undefined;
}

export class VideoExplanationService implements VideoExplanationServiceApi {
  private readonly listeners = new Set<VideoExplanationListener>();
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
        console.error('同步视频解释任务状态失败', error);
      });
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
      this.taskLocations.set(view.id, {
        projectId: view.projectId,
        assetId: view.assetId,
      });
    }
    return [...attachmentViews, ...taskViews].sort(
      (left, right) =>
        left.target.anchorPayload.timeSeconds -
          right.target.anchorPayload.timeSeconds ||
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
      parsed.value.contextProviderId ===
        VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID
      ? parsed.value
      : undefined;
  }

  private toTaskView(
    snapshot: GenerationTaskSnapshot,
  ): VideoExplanationTaskView | undefined {
    const instruction = this.taskInstruction(snapshot);
    const conversationContext = instruction?.context;
    if (
      !instruction?.commitAnswer ||
      !isVideoConversationContext(conversationContext)
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
      status: status === 'failed' ? 'failed' : 'pending',
      ...(snapshot.failure
        ? { failureMessage: snapshot.failure.message }
        : {}),
      createdTime: snapshot.createdTime,
      updatedTime: snapshot.updatedTime,
    });
  }

  private async toAttachmentView(
    attachment: VideoExplanationAttachment,
  ): Promise<VideoExplanationAttachmentView> {
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
      sourceRevision: attachment.metadata.sourceRevision,
      question: attachment.metadata.question,
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
    const conversationContext = instruction?.context;
    if (
      !instruction?.commitAnswer ||
      !isVideoConversationContext(conversationContext)
    ) {
      return;
    }
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
    if (new GenerationTask(event.snapshot).getStatus() === 'completed') return;
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

  private publish(event: VideoExplanationEvent): void {
    for (const listener of this.listeners) {
      try {
        Promise.resolve(listener(event)).catch((error: unknown) =>
          console.error('异步视频解释订阅者执行失败', error),
        );
      } catch (error) {
        console.error('发布视频解释事件失败', error);
      }
    }
  }
}
