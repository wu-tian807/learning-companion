import type { AssetAttachment } from '../../shared/attachments/contracts';
import { isWorkbenchConversationTaskResult } from '../../shared/workbench-conversation';
import type {
  AttachmentServiceApi,
  AttachmentServiceEvent,
} from '../attachments/attachment-service';
import { AppError } from '../errors/app-error';
import {
  GenerationTask,
  type GenerationTaskSnapshot,
} from '../generation/generation-task';
import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
} from '../generation/generation-task-service';

export interface WorkbenchConversationProjectionLocation {
  readonly projectId: string;
  readonly assetId: string;
}

export interface WorkbenchConversationProjectionView extends WorkbenchConversationProjectionLocation {
  readonly id: string;
  readonly kind: 'task' | 'attachment';
}

export interface WorkbenchConversationAttachmentProjectionOptions<
  TAttachment extends AssetAttachment,
  TTaskView extends WorkbenchConversationProjectionView & {
    readonly kind: 'task';
  },
  TAttachmentView extends WorkbenchConversationProjectionView & {
    readonly kind: 'attachment';
  },
  TEvent,
> {
  readonly label: string;
  readonly isAttachment: (
    attachment: AssetAttachment,
  ) => attachment is TAttachment;
  readonly locateTask: (
    snapshot: GenerationTaskSnapshot,
  ) => WorkbenchConversationProjectionLocation | undefined;
  readonly toTaskView: (
    snapshot: GenerationTaskSnapshot,
  ) => TTaskView | undefined;
  readonly toAttachmentView: (
    attachment: TAttachment,
  ) => Promise<TAttachmentView>;
  readonly events: {
    readonly changed: (view: TTaskView | TAttachmentView) => TEvent;
    readonly replaced: (
      location: WorkbenchConversationProjectionLocation,
      previousId: string,
      view: TAttachmentView,
    ) => TEvent;
    readonly deleted: (
      location: WorkbenchConversationProjectionLocation,
      id: string,
    ) => TEvent;
  };
}

export type WorkbenchConversationProjectionListener<TEvent> = (
  event: TEvent,
) => void | Promise<void>;

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
  return typeof attachmentId === 'string' && attachmentId.trim().length > 0
    ? attachmentId
    : undefined;
}

/**
 * Mechanical lifecycle shared by Workbench conversation projections.
 *
 * Media ownership stays outside this class: callers decide which tasks and
 * Attachments belong to them and how those records become renderer views.
 */
export class WorkbenchConversationAttachmentProjection<
  TAttachment extends AssetAttachment,
  TTaskView extends WorkbenchConversationProjectionView & {
    readonly kind: 'task';
  },
  TAttachmentView extends WorkbenchConversationProjectionView & {
    readonly kind: 'attachment';
  },
  TEvent,
> {
  private readonly listeners = new Set<
    WorkbenchConversationProjectionListener<TEvent>
  >();
  private readonly taskLocations = new Map<
    string,
    WorkbenchConversationProjectionLocation
  >();
  private readonly removeAttachmentSubscription: () => void;
  private readonly removeGenerationSubscription: () => void;
  private attachmentEventQueue = Promise.resolve();
  private generationEventQueue = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly attachments: AttachmentServiceApi,
    generationTasks: GenerationTaskServiceApi,
    private readonly options: WorkbenchConversationAttachmentProjectionOptions<
      TAttachment,
      TTaskView,
      TAttachmentView,
      TEvent
    >,
  ) {
    this.removeAttachmentSubscription = attachments.subscribe((event) => {
      this.attachmentEventQueue = this.attachmentEventQueue
        .then(() => this.handleAttachmentEvent(event))
        .catch((error: unknown) => {
          this.reportFailure('同步 Attachment 状态失败', error);
        });
    });
    this.removeGenerationSubscription = generationTasks.subscribe((event) => {
      this.generationEventQueue = this.generationEventQueue
        .then(() => this.handleGenerationEvent(event))
        .catch((error: unknown) => {
          this.reportFailure('同步 GenerationTask 状态失败', error);
        });
    });
  }

  trackTask(view: TTaskView): void {
    this.taskLocations.set(view.id, {
      projectId: view.projectId,
      assetId: view.assetId,
    });
  }

  subscribe(
    listener: WorkbenchConversationProjectionListener<TEvent>,
  ): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeAttachmentSubscription();
    this.removeGenerationSubscription();
    this.taskLocations.clear();
    this.listeners.clear();
  }

  private async handleAttachmentEvent(
    event: AttachmentServiceEvent,
  ): Promise<void> {
    if (!this.options.isAttachment(event.attachment)) return;
    const location = {
      projectId: event.attachment.projectId,
      assetId: event.attachment.assetId,
    };
    if (event.type === 'deleted') {
      this.publish(this.options.events.deleted(location, event.attachment.id));
      return;
    }
    const view = await this.options.toAttachmentView(event.attachment);
    this.publish(this.options.events.changed(view));
  }

  private async handleGenerationEvent(
    event: GenerationTaskServiceEvent,
  ): Promise<void> {
    if (event.type === 'execution-event') return;
    if (event.type === 'task-discarded') {
      const location = this.taskLocations.get(event.taskId);
      if (!location) return;
      this.taskLocations.delete(event.taskId);
      this.publish(this.options.events.deleted(location, event.taskId));
      return;
    }

    const location = this.options.locateTask(event.snapshot);
    if (!location) return;
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
        !this.options.isAttachment(attachment)
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const view = await this.options.toAttachmentView(attachment);
      this.publish(
        this.options.events.replaced(location, event.snapshot.id, view),
      );
      return;
    }

    if (new GenerationTask(event.snapshot).getStatus() === 'completed') {
      return;
    }
    const view = this.options.toTaskView(event.snapshot);
    if (!view) {
      this.taskLocations.delete(event.snapshot.id);
      this.publish(this.options.events.deleted(location, event.snapshot.id));
      return;
    }
    this.publish(this.options.events.changed(view));
  }

  private publish(event: TEvent): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        Promise.resolve(listener(event)).catch((error: unknown) => {
          this.reportFailure('异步订阅者执行失败', error);
        });
      } catch (error) {
        this.reportFailure('发布事件失败', error);
      }
    }
  }

  private reportFailure(message: string, error: unknown): void {
    console.error(`${this.options.label}：${message}`, error);
  }
}
