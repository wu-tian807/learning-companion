import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import { createStreamContentRevision } from '../../main/content/content-revision';
import { AppError } from '../../main/errors/app-error';
import type { WorkbenchEventBusApi } from '../../main/workbench/workbench-event-bus';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type {
  WorkbenchStateDatabaseApi,
  WorkbenchStateRecord,
} from '../../main/workbench/workbench-state-database';
import type {
  JsonValue,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import { MediaDubbingSessionResources } from '../media-dubbing/media-dubbing-session-resources';
import type {
  MediaDubbingServiceApi,
  MediaDubbingServiceSnapshot,
} from '../media-dubbing/media-dubbing-service';
import type {
  MediaSubtitleServiceApi,
  MediaSubtitleServiceEvent,
} from '../media-subtitles/media-subtitle-service';
import {
  AUDIO_STATE_SCHEMA_VERSION,
  AUDIO_WORKBENCH_ID,
  audioCommands,
  audioEventTypes,
  audioWorkbenchManifest,
  cloneAudioSpeakerTrackSnapshot,
  cloneAudioSubtitleCueFinalPayload,
  cloneAudioSubtitleSnapshot,
  cloneAudioViewState,
  DEFAULT_AUDIO_SUBTITLE_VIEW_STATE,
  DEFAULT_AUDIO_VIEW_STATE,
  EMPTY_AUDIO_DUBBING_SNAPSHOT,
  isAudioSaveViewStatePayload,
  isAudioSetSubtitleModePayload,
  isAudioWorkbenchStateV1,
  isAudioWorkbenchStateV2,
  type AudioSubtitleViewState,
  type AudioWorkbenchViewState,
} from './shared';

interface AudioSession {
  viewState: AudioWorkbenchViewState;
  subtitleState: AudioSubtitleViewState;
  readonly unsubscribeSubtitles: () => void;
  unsubscribeDubbing: () => void;
  unsubscribeSpeakerTrack: () => void;
  dubbingWarmupActive: boolean;
  readonly dubbingResources: MediaDubbingSessionResources;
}

export interface AudioWorkbenchProviderDependencies {
  readonly subtitles: MediaSubtitleServiceApi;
  readonly dubbing: MediaDubbingServiceApi;
  readonly events: WorkbenchEventBusApi;
  readonly now?: () => number;
}

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

export class AudioWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = audioWorkbenchManifest;
  private readonly sessions = new Map<string, AudioSession>();
  private readonly now: () => number;

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly stateDatabase: WorkbenchStateDatabaseApi,
    private readonly dependencies: AudioWorkbenchProviderDependencies,
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

    await this.dependencies.dubbing.refreshRuntimeAvailability(context.asset.id);
    const state = this.readState(context.state);
    const sourceRevision = await createStreamContentRevision(
      handle.openByteStream.bind(handle),
      context.signal,
    );
    const contentUrl = this.resourceService.register(
      context.sessionId,
      handle,
      context.asset.mediaType,
    );
    const unsubscribeSubtitles = this.dependencies.subtitles.subscribe(
      context.asset.id,
      (event) => this.publishSubtitleEvent(context.sessionId, event),
    );
    const session: AudioSession = {
      viewState: state.viewState,
      subtitleState: state.subtitleState,
      unsubscribeSubtitles,
      unsubscribeDubbing: () => undefined,
      unsubscribeSpeakerTrack: () => undefined,
      dubbingWarmupActive: false,
      dubbingResources: new MediaDubbingSessionResources(
        context.sessionId,
        this.resourceService,
        EMPTY_AUDIO_DUBBING_SNAPSHOT,
      ),
    };
    this.sessions.set(context.sessionId, session);
    session.unsubscribeDubbing = this.dependencies.dubbing.subscribe(
      context.asset.id,
      (snapshot) => this.publishDubbingSnapshot(context.sessionId, snapshot),
    );
    session.unsubscribeSpeakerTrack =
      this.dependencies.dubbing.subscribeSpeakerTrack(
        context.asset.id,
        (track) => this.publishSpeakerTrack(context.sessionId, track),
      );

    void this.dependencies.subtitles.ensureSource(
      context.asset.projectId,
      context.asset.id,
    );
    void this.restoreDubbingAndWarmup(
      context.sessionId,
      context.asset.projectId,
      context.asset.id,
    );
    if (
      state.subtitleState.displayMode === 'translated' ||
      state.subtitleState.displayMode === 'bilingual'
    ) {
      void this.dependencies.subtitles.ensureTranslation(
        context.asset.projectId,
        context.asset.id,
      );
    }

    return {
      payload: {
        contentUrl,
        sourceRevision,
        viewState: cloneAudioViewState(state.viewState),
        subtitleState: { ...state.subtitleState },
        subtitleSnapshot: cloneAudioSubtitleSnapshot(
          this.dependencies.subtitles.getSnapshot(context.asset.id),
        ),
        dubbingSnapshot: session.dubbingResources.attach(
          this.dependencies.dubbing.getSnapshot(context.asset.id),
        ),
        speakerTrackSnapshot: cloneAudioSpeakerTrackSnapshot({
          track: this.dependencies.dubbing.getSpeakerTrack(context.asset.id),
        }),
      },
    };
  }

  async command(
    context: Parameters<MainWorkbenchProvider['command']>[0],
    command: Parameters<MainWorkbenchProvider['command']>[1],
  ): Promise<WorkbenchCommandResult> {
    const session = this.sessions.get(context.sessionId);
    if (!session) throw new AppError('WORKBENCH_SESSION_NOT_FOUND');

    if (command.type === audioCommands.saveViewState) {
      if (!isAudioSaveViewStatePayload(command.payload)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      session.viewState = cloneAudioViewState(command.payload.viewState);
      return this.saveState(context.asset.id, session);
    }

    if (command.type === audioCommands.setSubtitleMode) {
      if (!isAudioSetSubtitleModePayload(command.payload)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      session.subtitleState = { displayMode: command.payload.displayMode };
      const result = await this.saveState(context.asset.id, session);
      if (
        command.payload.displayMode === 'translated' ||
        command.payload.displayMode === 'bilingual'
      ) {
        void this.dependencies.subtitles.ensureTranslation(
          context.asset.projectId,
          context.asset.id,
        );
      }
      return result;
    }

    if (command.type === audioCommands.retrySubtitles) {
      void this.dependencies.subtitles.retry(
        context.asset.projectId,
        context.asset.id,
      );
      return createResult({ started: true });
    }

    if (command.type === audioCommands.getSubtitleSnapshot) {
      return createResult(
        cloneAudioSubtitleSnapshot(
          this.dependencies.subtitles.getSnapshot(context.asset.id),
        ),
      );
    }

    if (command.type === audioCommands.startDubbing) {
      void this.dependencies.dubbing.ensure(
        context.asset.projectId,
        context.asset.id,
      );
      return createResult({ started: true });
    }

    if (command.type === audioCommands.retryDubbing) {
      void this.dependencies.dubbing.retry(
        context.asset.projectId,
        context.asset.id,
      );
      return createResult({ started: true });
    }

    if (command.type === audioCommands.getDubbingSnapshot) {
      return createResult(
        session.dubbingResources.attach(
          this.dependencies.dubbing.getSnapshot(context.asset.id),
        ),
      );
    }

    if (command.type === audioCommands.getSpeakerTrack) {
      return createResult(
        cloneAudioSpeakerTrackSnapshot({
          track: this.dependencies.dubbing.getSpeakerTrack(context.asset.id),
        }),
      );
    }

    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async close(
    context: Parameters<MainWorkbenchProvider['close']>[0],
  ): Promise<void> {
    const session = this.sessions.get(context.sessionId);
    if (!session) return;

    this.sessions.delete(context.sessionId);
    session.unsubscribeSubtitles();
    session.unsubscribeDubbing();
    session.unsubscribeSpeakerTrack();
    if (session.dubbingWarmupActive) {
      this.dependencies.dubbing.releaseWarmup(context.asset.id);
    }
    this.resourceService.revokeSession(context.sessionId);
    await session.dubbingResources.close();
  }

  private readState(record: WorkbenchStateRecord | undefined): {
    readonly viewState: AudioWorkbenchViewState;
    readonly subtitleState: AudioSubtitleViewState;
  } {
    if (
      record?.workbenchId === AUDIO_WORKBENCH_ID &&
      record.schemaVersion === AUDIO_STATE_SCHEMA_VERSION &&
      isAudioWorkbenchStateV2(record.payload)
    ) {
      return {
        viewState: cloneAudioViewState(record.payload.viewState),
        subtitleState: { ...record.payload.subtitleState },
      };
    }

    if (
      record?.workbenchId === AUDIO_WORKBENCH_ID &&
      record.schemaVersion === 1 &&
      isAudioWorkbenchStateV1(record.payload)
    ) {
      return {
        viewState: cloneAudioViewState(record.payload.viewState),
        subtitleState: { ...DEFAULT_AUDIO_SUBTITLE_VIEW_STATE },
      };
    }

    return {
      viewState: cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE),
      subtitleState: { ...DEFAULT_AUDIO_SUBTITLE_VIEW_STATE },
    };
  }

  private async saveState(
    assetId: string,
    session: AudioSession,
  ): Promise<WorkbenchCommandResult> {
    const savedTime = this.now();
    await this.stateDatabase.save({
      assetId,
      workbenchId: AUDIO_WORKBENCH_ID,
      schemaVersion: AUDIO_STATE_SCHEMA_VERSION,
      payload: {
        viewState: cloneAudioViewState(session.viewState),
        subtitleState: { ...session.subtitleState },
      },
      updatedTime: savedTime,
    });
    return createResult({ saved: true, savedTime });
  }

  private publishSubtitleEvent(
    sessionId: string,
    event: MediaSubtitleServiceEvent,
  ): void {
    if (!this.sessions.has(sessionId)) return;
    this.dependencies.events.publish({
      sessionId,
      type:
        event.type === 'snapshot'
          ? audioEventTypes.subtitleSnapshot
          : audioEventTypes.subtitleCueFinal,
      payload:
        event.type === 'snapshot'
          ? cloneAudioSubtitleSnapshot(event.snapshot)
          : cloneAudioSubtitleCueFinalPayload(event.payload),
    });
  }

  private publishDubbingSnapshot(
    sessionId: string,
    snapshot: MediaDubbingServiceSnapshot,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.dependencies.events.publish({
      sessionId,
      type: audioEventTypes.dubbingSnapshot,
      payload: session.dubbingResources.attach(snapshot),
    });
  }

  private publishSpeakerTrack(
    sessionId: string,
    track: ReturnType<MediaDubbingServiceApi['getSpeakerTrack']>,
  ): void {
    if (!this.sessions.has(sessionId)) return;
    this.dependencies.events.publish({
      sessionId,
      type: audioEventTypes.speakerTrack,
      payload: cloneAudioSpeakerTrackSnapshot({ track }),
    });
  }

  private async restoreDubbingAndWarmup(
    sessionId: string,
    projectId: string,
    assetId: string,
  ): Promise<void> {
    await this.dependencies.dubbing.restore(projectId, assetId);
    const session = this.sessions.get(sessionId);
    if (!session || session.dubbingWarmupActive) return;
    const phase = this.dependencies.dubbing.getSnapshot(assetId).phase;
    if (
      phase === 'ready' ||
      phase === 'runtime-required' ||
      phase === 'unsupported'
    ) {
      return;
    }
    session.dubbingWarmupActive = true;
    this.dependencies.dubbing.warmup(assetId);
  }
}
