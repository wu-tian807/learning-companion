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
  AUDIO_STATE_SCHEMA_VERSION,
  AUDIO_WORKBENCH_ID,
  audioCommands,
  audioWorkbenchManifest,
  cloneAudioViewState,
  DEFAULT_AUDIO_VIEW_STATE,
  isAudioSaveViewStatePayload,
  isAudioWorkbenchStateV1,
  type AudioWorkbenchViewState,
} from './shared';

export interface AudioWorkbenchProviderDependencies {
  readonly now: () => number;
}

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

export class AudioWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = audioWorkbenchManifest;
  private readonly sessions = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly stateRepository: WorkbenchStateRepository,
    dependencies: Partial<AudioWorkbenchProviderDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    const handle = context.content.handle;

    if (
      context.selectionReason !== 'matched' ||
      !audioWorkbenchManifest.supportedMediaTypes.includes(
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
        viewState: cloneAudioViewState(viewState),
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
      command.type !== audioCommands.saveViewState ||
      !isAudioSaveViewStatePayload(command.payload)
    ) {
      throw new AppError(
        command.type === audioCommands.saveViewState
          ? 'INVALID_IPC_REQUEST'
          : 'FEATURE_NOT_SUPPORTED',
      );
    }

    const savedTime = this.now();
    await this.stateRepository.save({
      assetId: context.asset.id,
      workbenchId: AUDIO_WORKBENCH_ID,
      schemaVersion: AUDIO_STATE_SCHEMA_VERSION,
      payload: {
        viewState: cloneAudioViewState(command.payload.viewState),
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
  ): AudioWorkbenchViewState {
    if (
      !record ||
      record.workbenchId !== AUDIO_WORKBENCH_ID ||
      record.schemaVersion !== AUDIO_STATE_SCHEMA_VERSION ||
      !isAudioWorkbenchStateV1(record.payload)
    ) {
      return cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE);
    }

    return cloneAudioViewState(record.payload.viewState);
  }
}
