import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type { WorkbenchEventBusApi } from '../../main/workbench/workbench-event-bus';
import type {
  JsonValue,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import {
  isLearningOutlineWorkbenchPayload,
  learningOutlineWorkbenchManifest,
  type LearningOutlineWorkbenchPayload,
} from './shared';
import type { LearningOutlineServiceApi } from './service/learning-outline-service';

export class LearningOutlineWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = learningOutlineWorkbenchManifest;
  private readonly eventSubscriptions = new Map<string, () => void>();
  readonly learningOutlineService: LearningOutlineServiceApi;

  constructor(
    outlines: LearningOutlineServiceApi,
    private readonly events?: WorkbenchEventBusApi,
  ) {
    this.learningOutlineService = outlines;
  }

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    if (context.selectionReason !== 'matched') {
      throw new AppError('ASSET_UNAVAILABLE');
    }
    if (this.eventSubscriptions.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }
    const unsubscribe = this.learningOutlineService.subscribe((event) => {
      if (event.assetId !== context.asset.id) return;
      this.events?.publish({
        sessionId: context.sessionId,
        type: event.type,
        payload: event as unknown as JsonValue,
      });
    });
    this.eventSubscriptions.set(context.sessionId, unsubscribe);
    try {
      const document = await this.learningOutlineService.readDocument(context.asset.id);
      const payload: LearningOutlineWorkbenchPayload = {
        document,
        brief: await this.learningOutlineService.readBriefState(context.asset.projectId, context.asset.id),
      };
      if (!isLearningOutlineWorkbenchPayload(payload)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      return { payload };
    } catch (error) {
      unsubscribe();
      this.eventSubscriptions.delete(context.sessionId);
      throw error;
    }
  }

  async command(): Promise<WorkbenchCommandResult> {
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async close(
    context: Parameters<MainWorkbenchProvider['close']>[0],
  ): Promise<void> {
    const unsubscribe = this.eventSubscriptions.get(context.sessionId);
    this.eventSubscriptions.delete(context.sessionId);
    unsubscribe?.();
  }
}
