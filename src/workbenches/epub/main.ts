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
  cloneEpubViewState,
  DEFAULT_EPUB_VIEW_STATE,
  EPUB_STATE_SCHEMA_VERSION,
  EPUB_WORKBENCH_ID,
  epubCommands,
  epubWorkbenchManifest,
  isEpubSaveViewStatePayload,
  isEpubWorkbenchStateV1,
  type EpubWorkbenchViewState,
} from './shared';

export interface EpubWorkbenchProviderDependencies {
  readonly now: () => number;
}

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

export class EpubWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = epubWorkbenchManifest;
  private readonly sessions = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly stateDatabase: WorkbenchStateDatabaseApi,
    dependencies: Partial<EpubWorkbenchProviderDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    const handle = context.content.handle;

    if (
      context.selectionReason !== 'matched' ||
      context.asset.mediaType !== 'application/epub+zip' ||
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
      'application/epub+zip',
    );
    this.sessions.add(context.sessionId);

    return {
      payload: {
        contentUrl,
        viewState: cloneEpubViewState(viewState),
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
      command.type !== epubCommands.saveViewState ||
      !isEpubSaveViewStatePayload(command.payload)
    ) {
      throw new AppError(
        command.type === epubCommands.saveViewState
          ? 'INVALID_IPC_REQUEST'
          : 'FEATURE_NOT_SUPPORTED',
      );
    }

    const savedTime = this.now();
    await this.stateDatabase.save({
      assetId: context.asset.id,
      workbenchId: EPUB_WORKBENCH_ID,
      schemaVersion: EPUB_STATE_SCHEMA_VERSION,
      payload: {
        viewState: cloneEpubViewState(command.payload.viewState),
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
  ): EpubWorkbenchViewState {
    if (
      !record ||
      record.workbenchId !== EPUB_WORKBENCH_ID ||
      record.schemaVersion !== EPUB_STATE_SCHEMA_VERSION ||
      !isEpubWorkbenchStateV1(record.payload)
    ) {
      return cloneEpubViewState(DEFAULT_EPUB_VIEW_STATE);
    }

    return cloneEpubViewState(record.payload.viewState);
  }
}
