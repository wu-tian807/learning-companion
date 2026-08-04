import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type {
  WorkbenchStateRecord,
  WorkbenchStateDatabaseApi,
} from '../../main/workbench/workbench-state-database';
import type {
  JsonValue,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import {
  cloneImageViewState,
  DEFAULT_IMAGE_VIEW_STATE,
  IMAGE_STATE_SCHEMA_VERSION,
  IMAGE_WORKBENCH_ID,
  imageCommands,
  imageWorkbenchManifest,
  isImageSaveViewStatePayload,
  isImageWorkbenchStateV1,
  type ImageWorkbenchViewState,
} from './shared';

export interface ImageWorkbenchProviderDependencies {
  readonly now: () => number;
}

function toJsonState(viewState: ImageWorkbenchViewState): JsonValue {
  return {
    viewState: cloneImageViewState(viewState),
  };
}

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

export class ImageWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = imageWorkbenchManifest;
  private readonly sessions = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly stateDatabase: WorkbenchStateDatabaseApi,
    dependencies: Partial<ImageWorkbenchProviderDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    const handle = context.content.handle;

    if (
      context.selectionReason !== 'matched' ||
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
        viewState: cloneImageViewState(viewState),
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
      command.type !== imageCommands.saveViewState ||
      !isImageSaveViewStatePayload(command.payload)
    ) {
      throw new AppError(
        command.type === imageCommands.saveViewState
          ? 'INVALID_IPC_REQUEST'
          : 'FEATURE_NOT_SUPPORTED',
      );
    }

    const savedTime = this.now();
    await this.stateDatabase.save({
      assetId: context.asset.id,
      workbenchId: IMAGE_WORKBENCH_ID,
      schemaVersion: IMAGE_STATE_SCHEMA_VERSION,
      payload: toJsonState(command.payload.viewState),
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
  ): ImageWorkbenchViewState {
    if (
      !record ||
      record.workbenchId !== IMAGE_WORKBENCH_ID ||
      record.schemaVersion !== IMAGE_STATE_SCHEMA_VERSION ||
      !isImageWorkbenchStateV1(record.payload)
    ) {
      return cloneImageViewState(DEFAULT_IMAGE_VIEW_STATE);
    }

    return cloneImageViewState(record.payload.viewState);
  }
}
