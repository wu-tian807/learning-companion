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
import { LocalFileContentHandle } from '../../main/content/resolvers/local-file/local-file-content-resolver';
import {
  cloneVideoDubbingSnapshot,
  cloneVideoViewState,
  cloneVideoSubtitleCueFinalPayload,
  cloneVideoSubtitleSnapshot,
  EMPTY_VIDEO_DUBBING_SNAPSHOT,
  DEFAULT_VIDEO_SUBTITLE_VIEW_STATE,
  DEFAULT_VIDEO_VIEW_STATE,
  isVideoSaveViewStatePayload,
  isVideoSetSubtitleModePayload,
  isVideoWorkbenchStateV1,
  isVideoWorkbenchStateV2,
  type VideoSubtitleViewState,
  type VideoDubbingSnapshot,
  type VideoWorkbenchViewState,
  VIDEO_STATE_SCHEMA_VERSION,
  VIDEO_WORKBENCH_ID,
  videoEventTypes,
  videoCommands,
  videoWorkbenchManifest,
} from './shared';
import type {
  VideoDubbingServiceApi,
  VideoDubbingServiceSnapshot,
} from './dubbing/video-dubbing-service';
import type {
  VideoSubtitleServiceApi,
  VideoSubtitleServiceEvent,
} from './subtitles/video-subtitle-service';
import { videoContentRevision } from './video-content-revision';

interface VideoSession {
  viewState: VideoWorkbenchViewState;
  subtitleState: VideoSubtitleViewState;
  readonly unsubscribeSubtitles: () => void;
  unsubscribeDubbing: () => void;
  dubbingWarmupActive: boolean;
  dubbingHandle?: LocalFileContentHandle;
  dubbingArtifactRevision?: string;
  dubbingAudioUrl?: string;
  dubbingPreview?: {
    readonly path: string;
    readonly handle: LocalFileContentHandle;
    readonly url: string;
  };
  dubbingSnapshot: VideoDubbingSnapshot;
}

export interface VideoWorkbenchProviderDependencies {
  readonly subtitles: VideoSubtitleServiceApi;
  readonly dubbing: VideoDubbingServiceApi;
  readonly events: WorkbenchEventBusApi;
  readonly now?: () => number;
}

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

function toPublicDubbingSnapshot(
  snapshot: VideoDubbingServiceSnapshot,
  resources: {
    readonly audioUrl?: string;
    readonly previewAudioUrl?: string;
  } = {},
): JsonValue & VideoDubbingSnapshot {
  return cloneVideoDubbingSnapshot({
    phase: snapshot.phase,
    completedPhrases: snapshot.completedPhrases,
    totalPhrases: snapshot.totalPhrases,
    completedDurationMs: snapshot.completedDurationMs,
    durationMs: snapshot.durationMs,
    readySuffixStartMs: snapshot.readySuffixStartMs,
    ...(resources.audioUrl ? { audioUrl: resources.audioUrl } : {}),
    ...(resources.previewAudioUrl
      ? { previewAudioUrl: resources.previewAudioUrl }
      : {}),
    ...(snapshot.message ? { message: snapshot.message } : {}),
  });
}

export class VideoWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = videoWorkbenchManifest;
  private readonly sessions = new Map<string, VideoSession>();
  private readonly subtitles: VideoSubtitleServiceApi;
  private readonly dubbing: VideoDubbingServiceApi;
  private readonly events: WorkbenchEventBusApi;
  private readonly now: () => number;

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly stateDatabase: WorkbenchStateDatabaseApi,
    dependencies: VideoWorkbenchProviderDependencies,
  ) {
    this.subtitles = dependencies.subtitles;
    this.dubbing = dependencies.dubbing;
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

    await this.dubbing.refreshRuntimeAvailability(context.asset.id);
    const state = this.readState(context.state);
    const sourceRevision = videoContentRevision(context.content);
    const contentUrl = this.resourceService.register(
      context.sessionId,
      handle,
      context.asset.mediaType,
    );
    const unsubscribeSubtitles = this.subtitles.subscribe(
      context.asset.id,
      (event) => this.publishSubtitleEvent(context.sessionId, event),
    );
    const session: VideoSession = {
      viewState: state.viewState,
      subtitleState: state.subtitleState,
      unsubscribeSubtitles,
      unsubscribeDubbing: () => undefined,
      dubbingWarmupActive: false,
      dubbingSnapshot: cloneVideoDubbingSnapshot(EMPTY_VIDEO_DUBBING_SNAPSHOT),
    };
    session.unsubscribeDubbing = this.dubbing.subscribe(
      context.asset.id,
      (snapshot) => this.publishDubbingSnapshot(context.sessionId, snapshot),
    );
    this.sessions.set(context.sessionId, session);
    void this.subtitles.ensureSource(context.asset.projectId, context.asset.id);
    void this.restoreDubbingAndWarmup(
      context.sessionId,
      context.asset.projectId,
      context.asset.id,
    );
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
        sourceRevision,
        viewState: cloneVideoViewState(state.viewState),
        subtitleState: { ...state.subtitleState },
        subtitleSnapshot: cloneVideoSubtitleSnapshot(
          this.subtitles.getSnapshot(context.asset.id),
        ),
        dubbingSnapshot: this.attachDubbingArtifact(
          context.sessionId,
          session,
          this.dubbing.getSnapshot(context.asset.id),
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

    if (command.type === videoCommands.getSubtitleSnapshot) {
      return createResult(
        cloneVideoSubtitleSnapshot(
          this.subtitles.getSnapshot(context.asset.id),
        ),
      );
    }

    if (command.type === videoCommands.startDubbing) {
      void this.dubbing.ensure(context.asset.projectId, context.asset.id);
      return createResult({ started: true });
    }

    if (command.type === videoCommands.retryDubbing) {
      void this.dubbing.retry(context.asset.projectId, context.asset.id);
      return createResult({ started: true });
    }

    if (command.type === videoCommands.getDubbingSnapshot) {
      return createResult(
        this.attachDubbingArtifact(
          context.sessionId,
          session,
          this.dubbing.getSnapshot(context.asset.id),
        ),
      );
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
      session.unsubscribeDubbing();
      if (session.dubbingWarmupActive) {
        this.dubbing.releaseWarmup(context.asset.id);
      }
      this.resourceService.revokeSession(context.sessionId);
      await Promise.all([
        session.dubbingHandle?.close(),
        session.dubbingPreview?.handle.close(),
      ]);
    }
  }

  private readState(record: WorkbenchStateRecord | undefined): {
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

  private publishDubbingSnapshot(
    sessionId: string,
    snapshot: VideoDubbingServiceSnapshot,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.events.publish({
      sessionId,
      type: videoEventTypes.dubbingSnapshot,
      payload: this.attachDubbingArtifact(sessionId, session, snapshot),
    });
  }

  private async restoreDubbingAndWarmup(
    sessionId: string,
    projectId: string,
    assetId: string,
  ): Promise<void> {
    await this.dubbing.restore(projectId, assetId);
    const session = this.sessions.get(sessionId);
    if (!session || session.dubbingWarmupActive) return;
    const phase = this.dubbing.getSnapshot(assetId).phase;
    if (
      phase === 'ready' ||
      phase === 'runtime-required' ||
      phase === 'unsupported'
    ) {
      return;
    }
    session.dubbingWarmupActive = true;
    this.dubbing.warmup(assetId);
  }

  private attachDubbingArtifact(
    sessionId: string,
    session: VideoSession,
    snapshot: VideoDubbingServiceSnapshot,
  ): JsonValue & VideoDubbingSnapshot {
    if (
      snapshot.phase === 'ready' &&
      snapshot.artifactPath &&
      snapshot.artifactRevision &&
      session.dubbingArtifactRevision !== snapshot.artifactRevision
    ) {
      void session.dubbingHandle?.close();
      const handle = new LocalFileContentHandle(snapshot.artifactPath);
      const audioUrl = this.resourceService.register(
        sessionId,
        handle,
        'audio/mp4',
      );
      session.dubbingHandle = handle;
      session.dubbingArtifactRevision = snapshot.artifactRevision;
      session.dubbingAudioUrl = audioUrl;
    }
    if (snapshot.phase === 'ready' && session.dubbingAudioUrl) {
      void session.dubbingPreview?.handle.close();
      session.dubbingPreview = undefined;
      session.dubbingSnapshot = toPublicDubbingSnapshot(snapshot, {
        audioUrl: session.dubbingAudioUrl,
      });
    } else if (
      (snapshot.phase === 'cloning' ||
        snapshot.phase === 'mixing' ||
        snapshot.phase === 'interrupted' ||
        snapshot.phase === 'failed') &&
      snapshot.previewAudioPath
    ) {
      if (session.dubbingPreview?.path !== snapshot.previewAudioPath) {
        void session.dubbingPreview?.handle.close();
        const handle = new LocalFileContentHandle(snapshot.previewAudioPath);
        session.dubbingPreview = {
          path: snapshot.previewAudioPath,
          handle,
          url: this.resourceService.register(sessionId, handle, 'audio/wav'),
        };
      }
      session.dubbingSnapshot = toPublicDubbingSnapshot(snapshot, {
        previewAudioUrl: session.dubbingPreview.url,
      });
    } else {
      session.dubbingSnapshot = toPublicDubbingSnapshot(snapshot);
    }
    return cloneVideoDubbingSnapshot(session.dubbingSnapshot);
  }
}
