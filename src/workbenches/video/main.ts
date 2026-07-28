import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type {
  WorkbenchStateRecord,
  WorkbenchStateRepository,
} from '../../main/workbench/workbench-state-repository';
import type {
  JsonValue,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import {
  cloneVideoViewState,
  DEFAULT_VIDEO_VIEW_STATE,
  isVideoSaveViewStatePayload,
  isVideoWorkbenchStateV1,
  type VideoWorkbenchViewState,
  VIDEO_STATE_SCHEMA_VERSION,
  VIDEO_WORKBENCH_ID,
  videoCommands,
  videoWorkbenchManifest,
} from './shared';

export interface VideoWorkbenchProviderDependencies {
  readonly now: () => number;
}

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

export class VideoWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = videoWorkbenchManifest;
  private readonly sessions = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly stateRepository: WorkbenchStateRepository,
    dependencies: Partial<VideoWorkbenchProviderDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    const handle = context.content.handle;

    if (
      context.selectionReason !== 'matched' ||
      !videoWorkbenchManifest.supportedMediaTypes.includes(
        context.asset.mediaType,
      ) ||
      !handle?.capabilities.has('read-stream') ||
      !handle.openByteStream
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    if (this.sessions.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    const viewState = this.readViewState(context.state);
    const contentUrl = this.resourceService.register(
      context.sessionId,
      handle,
      context.asset.mediaType,
    );
    this.sessions.add(context.sessionId);

    return {
      payload: {
        contentUrl,
        viewState: cloneVideoViewState(viewState),
      },
    };
  }

  async command(
    context: Parameters<MainWorkbenchProvider['command']>[0],
    command: Parameters<MainWorkbenchProvider['command']>[1],
  ): Promise<WorkbenchCommandResult> {
    if (!this.sessions.has(context.sessionId)) {
      throw new AppError('WORKBENCH_SESSION_NOT_FOUND');
    }
    if (
      command.type !== videoCommands.saveViewState ||
      !isVideoSaveViewStatePayload(command.payload)
    ) {
      throw new AppError(
        command.type === videoCommands.saveViewState
          ? 'INVALID_IPC_REQUEST'
          : 'FEATURE_NOT_SUPPORTED',
      );
    }

    const savedTime = this.now();
    await this.stateRepository.save({
      assetId: context.asset.id,
      workbenchId: VIDEO_WORKBENCH_ID,
      schemaVersion: VIDEO_STATE_SCHEMA_VERSION,
      payload: {
        viewState: cloneVideoViewState(command.payload.viewState),
      },
      updatedTime: savedTime,
    });

    return createResult({ saved: true, savedTime });
  }

  async close(
    context: Parameters<MainWorkbenchProvider['close']>[0],
  ): Promise<void> {
    if (this.sessions.delete(context.sessionId)) {
      this.resourceService.revokeSession(context.sessionId);
    }
  }

  private readViewState(
    record: WorkbenchStateRecord | undefined,
  ): VideoWorkbenchViewState {
    if (
      !record ||
      record.workbenchId !== VIDEO_WORKBENCH_ID ||
      record.schemaVersion !== VIDEO_STATE_SCHEMA_VERSION ||
      !isVideoWorkbenchStateV1(record.payload)
    ) {
      return cloneVideoViewState(DEFAULT_VIDEO_VIEW_STATE);
    }

    return cloneVideoViewState(record.payload.viewState);
  }
}
