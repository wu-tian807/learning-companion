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
import type { WorkbenchEventBusApi } from '../../main/workbench/workbench-event-bus';
import {
  cloneVideoViewState,
  cloneVideoSubtitleCueFinalPayload,
  cloneVideoSubtitleSnapshot,
  DEFAULT_VIDEO_SUBTITLE_VIEW_STATE,
  DEFAULT_VIDEO_VIEW_STATE,
  isVideoSaveViewStatePayload,
  isVideoSetSubtitleModePayload,
  isVideoWorkbenchStateV1,
  isVideoWorkbenchStateV2,
  type VideoSubtitleViewState,
  type VideoWorkbenchViewState,
  VIDEO_STATE_SCHEMA_VERSION,
  VIDEO_WORKBENCH_ID,
  videoEventTypes,
  videoCommands,
  videoWorkbenchManifest,
} from './shared';
import type {
  VideoSubtitleServiceApi,
  VideoSubtitleServiceEvent,
} from './subtitles/video-subtitle-service';

interface VideoSession {
  viewState: VideoWorkbenchViewState;
  subtitleState: VideoSubtitleViewState;
  readonly unsubscribeSubtitles: () => void;
}

export interface VideoWorkbenchProviderDependencies {
  readonly subtitles: VideoSubtitleServiceApi;
  readonly events: WorkbenchEventBusApi;
  readonly now?: () => number;
}

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

export class VideoWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = videoWorkbenchManifest;
  private readonly sessions = new Map<string, VideoSession>();
  private readonly subtitles: VideoSubtitleServiceApi;
  private readonly events: WorkbenchEventBusApi;
  private readonly now: () => number;

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly stateDatabase: WorkbenchStateDatabaseApi,
    dependencies: VideoWorkbenchProviderDependencies,
  ) {
    this.subtitles = dependencies.subtitles;
    this.events = dependencies.events;
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

    const state = this.readState(context.state);
    const contentUrl = this.resourceService.register(
      context.sessionId,
      handle,
      context.asset.mediaType,
    );
    const unsubscribeSubtitles = this.subtitles.subscribe(
      context.asset.id,
      (event) => this.publishSubtitleEvent(context.sessionId, event),
    );
    this.sessions.set(context.sessionId, {
      viewState: state.viewState,
      subtitleState: state.subtitleState,
      unsubscribeSubtitles,
    });
    void this.subtitles.ensureSource(context.asset.projectId, context.asset.id);
    if (
      state.subtitleState.displayMode === 'translated' ||
      state.subtitleState.displayMode === 'bilingual'
    ) {
      void this.subtitles.ensureTranslation(
        context.asset.projectId,
        context.asset.id,
      );
    }

    return {
      payload: {
        contentUrl,
        viewState: cloneVideoViewState(state.viewState),
        subtitleState: { ...state.subtitleState },
        subtitleSnapshot:
          cloneVideoSubtitleSnapshot(
            this.subtitles.getSnapshot(context.asset.id),
          ),
      },
    };
  }

  async command(
    context: Parameters<MainWorkbenchProvider['command']>[0],
    command: Parameters<MainWorkbenchProvider['command']>[1],
  ): Promise<WorkbenchCommandResult> {
    const session = this.sessions.get(context.sessionId);
    if (!session) {
      throw new AppError('WORKBENCH_SESSION_NOT_FOUND');
    }

    if (command.type === videoCommands.saveViewState) {
      if (!isVideoSaveViewStatePayload(command.payload)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      session.viewState = cloneVideoViewState(command.payload.viewState);
      return this.saveState(context.asset.id, session);
    }

    if (command.type === videoCommands.setSubtitleMode) {
      if (!isVideoSetSubtitleModePayload(command.payload)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      session.subtitleState = {
        displayMode: command.payload.displayMode,
      };
      const result = await this.saveState(context.asset.id, session);
      if (
        command.payload.displayMode === 'translated' ||
        command.payload.displayMode === 'bilingual'
      ) {
        void this.subtitles.ensureTranslation(
          context.asset.projectId,
          context.asset.id,
        );
      }
      return result;
    }

    if (command.type === videoCommands.retrySubtitles) {
      void this.subtitles.retry(context.asset.projectId, context.asset.id);
      return createResult({ started: true });
    }

    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async close(
    context: Parameters<MainWorkbenchProvider['close']>[0],
  ): Promise<void> {
    const session = this.sessions.get(context.sessionId);
    if (session) {
      this.sessions.delete(context.sessionId);
      session.unsubscribeSubtitles();
      this.resourceService.revokeSession(context.sessionId);
    }
  }

  private readState(
    record: WorkbenchStateRecord | undefined,
  ): {
    readonly viewState: VideoWorkbenchViewState;
    readonly subtitleState: VideoSubtitleViewState;
  } {
    if (
      record?.workbenchId === VIDEO_WORKBENCH_ID &&
      record.schemaVersion === VIDEO_STATE_SCHEMA_VERSION &&
      isVideoWorkbenchStateV2(record.payload)
    ) {
      return {
        viewState: cloneVideoViewState(record.payload.viewState),
        subtitleState: { ...record.payload.subtitleState },
      };
    }

    if (
      record?.workbenchId === VIDEO_WORKBENCH_ID &&
      record.schemaVersion === 1 &&
      isVideoWorkbenchStateV1(record.payload)
    ) {
      return {
        viewState: cloneVideoViewState(record.payload.viewState),
        subtitleState: { ...DEFAULT_VIDEO_SUBTITLE_VIEW_STATE },
      };
    }

    return {
      viewState: cloneVideoViewState(DEFAULT_VIDEO_VIEW_STATE),
      subtitleState: { ...DEFAULT_VIDEO_SUBTITLE_VIEW_STATE },
    };
  }

  private async saveState(
    assetId: string,
    session: VideoSession,
  ): Promise<WorkbenchCommandResult> {
    const savedTime = this.now();
    await this.stateDatabase.save({
      assetId,
      workbenchId: VIDEO_WORKBENCH_ID,
      schemaVersion: VIDEO_STATE_SCHEMA_VERSION,
      payload: {
        viewState: cloneVideoViewState(session.viewState),
        subtitleState: { ...session.subtitleState },
      },
      updatedTime: savedTime,
    });
    return createResult({ saved: true, savedTime });
  }

  private publishSubtitleEvent(
    sessionId: string,
    event: VideoSubtitleServiceEvent,
  ): void {
    if (!this.sessions.has(sessionId)) return;
    this.events.publish({
      sessionId,
      type:
        event.type === 'snapshot'
          ? videoEventTypes.subtitleSnapshot
          : videoEventTypes.subtitleCueFinal,
      payload:
        event.type === 'snapshot'
          ? cloneVideoSubtitleSnapshot(event.snapshot)
          : cloneVideoSubtitleCueFinalPayload(event.payload),
    });
  }
}
