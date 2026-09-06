import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import { createStreamContentRevision } from '../../main/content/content-revision';
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
  clonePdfWorkbenchState,
  DEFAULT_PDF_WORKBENCH_STATE,
  PDF_STATE_SCHEMA_VERSION,
  PDF_WORKBENCH_ID,
  pdfCommands,
  pdfWorkbenchManifest,
  isPdfSaveViewStatePayload,
  isPdfWorkbenchStateV1,
  type PdfWorkbenchViewState,
} from './shared';

export interface PdfWorkbenchProviderDependencies {
  readonly now: () => number;
}

function toJsonState(state: PdfWorkbenchViewState): JsonValue {
  return clonePdfWorkbenchState(state);
}

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

export class PdfWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = pdfWorkbenchManifest;
  private readonly sessions = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly stateDatabase: WorkbenchStateDatabaseApi,
    dependencies: Partial<PdfWorkbenchProviderDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    const handle = context.content.handle;

    if (
      context.selectionReason !== 'matched' ||
      context.asset.mediaType !== 'application/pdf' ||
      !handle?.capabilities.has('read-stream') ||
      !handle.openByteStream
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    if (this.sessions.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    const viewState = this.readViewState(context.state);
    const sourceRevision = await createStreamContentRevision(
      handle.openByteStream.bind(handle),
      context.signal,
    );
    const contentUrl = this.resourceService.register(
      context.sessionId,
      handle,
      'application/pdf',
    );
    this.sessions.add(context.sessionId);

    return {
      payload: {
        contentUrl,
        sourceRevision,
        viewState: clonePdfWorkbenchState(viewState),
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
      command.type !== pdfCommands.saveViewState ||
      !isPdfSaveViewStatePayload(command.payload)
    ) {
      throw new AppError(
        command.type === pdfCommands.saveViewState
          ? 'INVALID_IPC_REQUEST'
          : 'FEATURE_NOT_SUPPORTED',
      );
    }

    const savedTime = this.now();
    await this.stateDatabase.save({
      assetId: context.asset.id,
      workbenchId: PDF_WORKBENCH_ID,
      schemaVersion: PDF_STATE_SCHEMA_VERSION,
      payload: toJsonState(command.payload.viewState),
      updatedTime: savedTime,
    });

    return createResult({ saved: true, savedTime });
  }

  async close(
    context: Parameters<MainWorkbenchProvider['close']>[0],
  ): Promise<void> {
    if (!this.sessions.delete(context.sessionId)) {
      return;
    }

    this.resourceService.revokeSession(context.sessionId);
  }

  private readViewState(
    record: WorkbenchStateRecord | undefined,
  ): PdfWorkbenchViewState {
    if (
      !record ||
      record.workbenchId !== PDF_WORKBENCH_ID ||
      record.schemaVersion !== PDF_STATE_SCHEMA_VERSION ||
      !isPdfWorkbenchStateV1(record.payload)
    ) {
      return clonePdfWorkbenchState(DEFAULT_PDF_WORKBENCH_STATE);
    }

    return clonePdfWorkbenchState(record.payload);
  }
}
