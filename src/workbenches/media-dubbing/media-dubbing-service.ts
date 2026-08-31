import { createHash } from 'node:crypto';

import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
} from '../../main/artifacts/asset-artifact-service';
import type { AssetServiceApi } from '../../main/assets/asset-service';
import { AppError, describeAppError } from '../../main/errors/app-error';
import type { ProjectLookup } from '../../main/projects/project-database';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
  isTranslatableSubtitleLanguage,
  oppositeSubtitleLanguage,
  type SubtitleTranslationTrackV1,
} from '../media-subtitles/contracts';
import { readSubtitleTranslationTrackFile } from '../media-subtitles/subtitle-artifact-files';
import {
  resolveCachedMediaSubtitleSource,
  type ResolvedMediaSubtitleSource,
} from '../media-subtitles/subtitle-source-artifact';
import {
  MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
  createSubtitleTranslationArtifactKey,
} from '../media-subtitles/translation-producer';
import type { MediaSubtitleServiceApi } from '../media-subtitles/media-subtitle-service';
import type { MediaSubtitleRuntimeResolverApi } from '../media-subtitles/external-libraries/media-subtitle-runtime';
import {
  DUBBING_SPEAKER_TRACK_ARTIFACT_KEY,
  DUBBING_SPEAKER_TRACK_PRODUCER_ID,
  resolveCachedDubbingSpeakerTrack,
  type DubbingSpeakerTrackArtifactProducerApi,
} from './dubbing-speaker-track-artifact';
import {
  cloneDubbingSpeakerTrack,
  type DubbingSpeakerTrackV1,
} from './dubbing-speaker-track';
import type { VoxCpm2DubbingRuntimeResolverApi } from './external-libraries/voxcpm2-runtime';
import {
  VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE,
  VOXCPM2_DUBBING_PRODUCER_ID,
  createVoxCpm2DubbingArtifactKey,
  type MediaDubbingProgress,
  type MediaDubbingProgressHub,
  type VoxCpm2DubbingProducer,
} from './voxcpm2-dubbing-producer';

export type MediaDubbingServicePhase =
  | 'idle'
  | 'awaiting-translation'
  | 'runtime-required'
  | 'preparing-runtime'
  | 'separating'
  | 'cloning'
  | 'mixing'
  | 'interrupted'
  | 'ready'
  | 'unsupported'
  | 'failed';

export interface MediaDubbingServiceSnapshot {
  readonly phase: MediaDubbingServicePhase;
  readonly completedPhrases: number;
  readonly totalPhrases: number;
  readonly completedDurationMs: number;
  readonly durationMs: number;
  readonly readySuffixStartMs: number;
  readonly artifactPath?: string;
  readonly artifactRevision?: string;
  readonly previewAudioPath?: string;
  readonly message?: string;
}

export interface MediaDubbingServiceApi {
  getSnapshot(assetId: string): MediaDubbingServiceSnapshot;
  getSpeakerTrack(assetId: string): DubbingSpeakerTrackV1 | undefined;
  subscribe(
    assetId: string,
    listener: (snapshot: MediaDubbingServiceSnapshot) => void,
  ): () => void;
  subscribeSpeakerTrack(
    assetId: string,
    listener: (track: DubbingSpeakerTrackV1 | undefined) => void,
  ): () => void;
  refreshRuntimeAvailability(assetId: string): Promise<void>;
  restore(projectId: string, assetId: string): Promise<void>;
  warmup(assetId: string): void;
  releaseWarmup(assetId: string): void;
  ensure(projectId: string, assetId: string): Promise<void>;
  retry(projectId: string, assetId: string): Promise<void>;
}

const EMPTY_SNAPSHOT: MediaDubbingServiceSnapshot = Object.freeze({
  phase: 'idle',
  completedPhrases: 0,
  totalPhrases: 0,
  completedDurationMs: 0,
  durationMs: 0,
  readySuffixStartMs: 0,
});

interface ResolvedDubbingInput {
  readonly source: ResolvedMediaSubtitleSource;
  readonly translation: SubtitleTranslationTrackV1;
  readonly request: AssetArtifactRequest;
  readonly speakerTrackRequest: AssetArtifactRequest;
}

function cloneSnapshot(
  snapshot: MediaDubbingServiceSnapshot,
): MediaDubbingServiceSnapshot {
  return Object.freeze({ ...snapshot });
}

function dubbingSourceRevision(input: {
  readonly sourceRevision: string;
  readonly sourceTrackRevision: string;
  readonly translation: SubtitleTranslationTrackV1;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function failureMessage(error: unknown): string {
  const described = describeAppError(error);
  return described.userMessage ?? '媒体配音没有完成。';
}

export class MediaDubbingService implements MediaDubbingServiceApi {
  private readonly snapshots = new Map<string, MediaDubbingServiceSnapshot>();
  private readonly listeners = new Map<
    string,
    Set<(snapshot: MediaDubbingServiceSnapshot) => void>
  >();
  private readonly speakerTracks = new Map<string, DubbingSpeakerTrackV1>();
  private readonly speakerTrackListeners = new Map<
    string,
    Set<(track: DubbingSpeakerTrackV1 | undefined) => void>
  >();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly restoreTasks = new Map<string, Promise<void>>();
  private readonly activeRevisions = new Map<string, string>();
  private readonly warmupConsumers = new Map<string, number>();

  constructor(
    private readonly assets: AssetServiceApi,
    private readonly projects: ProjectLookup,
    private readonly artifacts: AssetArtifactServiceApi,
    private readonly subtitles: MediaSubtitleServiceApi,
    private readonly producer: VoxCpm2DubbingProducer,
    private readonly speakerTrackProducer: DubbingSpeakerTrackArtifactProducerApi,
    private readonly subtitleRuntime: MediaSubtitleRuntimeResolverApi,
    private readonly dubbingRuntime: VoxCpm2DubbingRuntimeResolverApi,
    progress: MediaDubbingProgressHub,
    private readonly logger: Pick<Console, 'error' | 'warn'> = console,
  ) {
    progress.subscribe((event) => this.handleProgress(event));
  }

  getSnapshot(assetId: string): MediaDubbingServiceSnapshot {
    return cloneSnapshot(this.snapshots.get(assetId) ?? EMPTY_SNAPSHOT);
  }

  getSpeakerTrack(assetId: string): DubbingSpeakerTrackV1 | undefined {
    const track = this.speakerTracks.get(assetId);
    return track ? cloneDubbingSpeakerTrack(track) : undefined;
  }

  subscribe(
    assetId: string,
    listener: (snapshot: MediaDubbingServiceSnapshot) => void,
  ): () => void {
    const listeners = this.listeners.get(assetId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(assetId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(assetId);
    };
  }

  subscribeSpeakerTrack(
    assetId: string,
    listener: (track: DubbingSpeakerTrackV1 | undefined) => void,
  ): () => void {
    const listeners = this.speakerTrackListeners.get(assetId) ?? new Set();
    listeners.add(listener);
    this.speakerTrackListeners.set(assetId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.speakerTrackListeners.delete(assetId);
    };
  }

  async refreshRuntimeAvailability(assetId: string): Promise<void> {
    try {
      await this.dubbingRuntime.requireInstalledBundle();
      const current = this.getSnapshot(assetId);
      if (
        current.phase === 'runtime-required' ||
        current.phase === 'unsupported'
      ) {
        this.update(assetId, EMPTY_SNAPSHOT);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (!this.applyRuntimeFailure(assetId, error)) {
        this.update(assetId, {
          ...this.getSnapshot(assetId),
          phase: 'failed',
          message: failureMessage(error),
        });
      }
    }
  }

  async restore(projectId: string, assetId: string): Promise<void> {
    if (this.tasks.has(assetId)) return;
    const active = this.restoreTasks.get(assetId);
    if (active) return active;
    const task = this.restoreState(projectId, assetId).finally(() =>
      this.restoreTasks.delete(assetId),
    );
    this.restoreTasks.set(assetId, task);
    return task;
  }

  warmup(assetId: string): void {
    const current = this.getSnapshot(assetId);
    if (
      current.phase === 'runtime-required' ||
      current.phase === 'unsupported'
    ) {
      return;
    }
    this.warmupConsumers.set(
      assetId,
      (this.warmupConsumers.get(assetId) ?? 0) + 1,
    );
    void this.dubbingRuntime.warmup().catch((error: unknown) => {
      this.logger.warn('[media:dubbing] VoxCPM2 后台预热失败', error);
    });
  }

  releaseWarmup(assetId: string): void {
    const consumers = this.warmupConsumers.get(assetId) ?? 0;
    if (consumers <= 1) this.warmupConsumers.delete(assetId);
    else this.warmupConsumers.set(assetId, consumers - 1);
    if (consumers === 0) return;
    void this.dubbingRuntime.releaseWarmup().catch((error: unknown) => {
      this.logger.warn('[media:dubbing] 释放 VoxCPM2 预热进程失败', error);
    });
  }

  async ensure(projectId: string, assetId: string): Promise<void> {
    const active = this.tasks.get(assetId);
    if (active) return active;
    const task = this.generate(projectId, assetId).finally(() => {
      this.tasks.delete(assetId);
      this.activeRevisions.delete(assetId);
    });
    this.tasks.set(assetId, task);
    return task;
  }

  async retry(projectId: string, assetId: string): Promise<void> {
    return this.ensure(projectId, assetId);
  }

  private async generate(projectId: string, assetId: string): Promise<void> {
    try {
      await this.dubbingRuntime.requireInstalledBundle();
      await this.requireTranslation(projectId, assetId);
      const input = await this.resolveCachedInput(projectId, assetId);
      if (!input) throw new AppError('DATA_INTEGRITY_ERROR');
      const { source, translation, request, speakerTrackRequest } = input;
      const revision = request.source.revision;
      this.activeRevisions.set(assetId, revision);
      const cachedSpeakerTrack = await resolveCachedDubbingSpeakerTrack(
        this.artifacts,
        speakerTrackRequest,
        source.track,
      );
      if (cachedSpeakerTrack) {
        this.updateSpeakerTrack(assetId, cachedSpeakerTrack.track);
      } else if (
        this.speakerTracks.get(assetId)?.sourceTrackRevision !==
        translation.sourceTrackRevision
      ) {
        this.updateSpeakerTrack(assetId, undefined);
      }
      const cached = await this.artifacts.getCached(request);
      const artifact =
        cached ??
        (await this.producer.materialize(
          this.artifacts,
          request,
          source.track,
          translation,
          this.subtitleRuntime,
          this.dubbingRuntime,
        ));
      if (artifact.artifact.mediaType !== VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const speakerTrack =
        cachedSpeakerTrack?.track ??
        this.speakerTracks.get(assetId) ??
        (await this.producer.getPreparedSpeakerTrack(
          request,
          source.track,
          translation,
        ));
      if (
        speakerTrack &&
        speakerTrack.sourceTrackRevision !== translation.sourceTrackRevision
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      if (!speakerTrack && !cached) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      if (speakerTrack && !cachedSpeakerTrack) {
        await this.speakerTrackProducer.materialize(
          this.artifacts,
          speakerTrackRequest,
          source.track,
          speakerTrack,
        );
      }
      if (speakerTrack) this.updateSpeakerTrack(assetId, speakerTrack);
      const current = this.getSnapshot(assetId);
      const durationMs = Math.max(
        current.durationMs,
        source.track.cues.at(-1)?.endMs ?? 0,
      );
      this.update(assetId, {
        ...current,
        phase: 'ready',
        completedPhrases: Math.max(
          current.completedPhrases,
          current.totalPhrases,
        ),
        completedDurationMs: durationMs,
        durationMs,
        readySuffixStartMs: 0,
        artifactPath: artifact.absolutePath,
        artifactRevision: artifact.artifact.artifactRevision,
        previewAudioPath: undefined,
        message: undefined,
      });
      await this.producer
        .removeCheckpoint(request, source.track, translation)
        .catch((error: unknown) => {
          this.logger.warn('[media:dubbing] 清理已完成的配音检查点失败', error);
        });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (this.applyRuntimeFailure(assetId, error)) return;
      this.logger.error('[media:dubbing] 配音生成失败', error);
      this.update(assetId, {
        ...this.getSnapshot(assetId),
        phase: 'failed',
        message: failureMessage(error),
      });
    }
  }

  private async restoreState(projectId: string, assetId: string): Promise<void> {
    const current = this.getSnapshot(assetId);
    if (
      current.phase === 'runtime-required' ||
      current.phase === 'unsupported'
    ) {
      return;
    }
    try {
      const input = await this.resolveCachedInput(projectId, assetId);
      if (!input || this.tasks.has(assetId)) return;
      const cachedSpeakerTrack = await resolveCachedDubbingSpeakerTrack(
        this.artifacts,
        input.speakerTrackRequest,
        input.source.track,
      );
      if (cachedSpeakerTrack) {
        this.updateSpeakerTrack(assetId, cachedSpeakerTrack.track);
      } else if (
        this.speakerTracks.get(assetId)?.sourceTrackRevision !==
        input.translation.sourceTrackRevision
      ) {
        this.updateSpeakerTrack(assetId, undefined);
      }
      const cached = await this.artifacts.getCached(input.request);
      if (cached) {
        if (cached.artifact.mediaType !== VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE) {
          throw new AppError('DATA_INTEGRITY_ERROR');
        }
        if (!cachedSpeakerTrack) {
          const preparedTrack = await this.producer.getPreparedSpeakerTrack(
            input.request,
            input.source.track,
            input.translation,
          );
          if (preparedTrack) {
            await this.speakerTrackProducer.materialize(
              this.artifacts,
              input.speakerTrackRequest,
              input.source.track,
              preparedTrack,
            );
            this.updateSpeakerTrack(assetId, preparedTrack);
            await this.producer
              .removeCheckpoint(
                input.request,
                input.source.track,
                input.translation,
              )
              .catch((error: unknown) => {
                this.logger.warn(
                  '[media:dubbing] 清理已恢复的配音检查点失败',
                  error,
                );
              });
          }
        }
        const durationMs = input.source.track.cues.at(-1)?.endMs ?? 0;
        this.update(assetId, {
          ...EMPTY_SNAPSHOT,
          phase: 'ready',
          completedDurationMs: durationMs,
          durationMs,
          artifactPath: cached.absolutePath,
          artifactRevision: cached.artifact.artifactRevision,
        });
        return;
      }
      const progress = await this.producer.getInterruptedProgress(
        input.request,
        input.source.track,
        input.translation,
      );
      if (!progress || this.tasks.has(assetId)) return;
      if (progress.speakerTrack) {
        this.updateSpeakerTrack(assetId, progress.speakerTrack);
      }
      this.update(assetId, {
        phase: 'interrupted',
        completedPhrases: progress.completedPhrases,
        totalPhrases: progress.totalPhrases,
        completedDurationMs: progress.completedDurationMs,
        durationMs: progress.durationMs,
        readySuffixStartMs: progress.readySuffixStartMs,
        previewAudioPath: progress.previewAudioPath,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      this.logger.warn('[media:dubbing] 恢复配音状态失败', error);
    }
  }

  private async resolveCachedInput(
    projectId: string,
    assetId: string,
  ): Promise<ResolvedDubbingInput | undefined> {
    const source = await resolveCachedMediaSubtitleSource(
      this.assets,
      this.artifacts,
      this.projects,
      projectId,
      assetId,
    );
    if (!source || !isTranslatableSubtitleLanguage(source.track.language)) {
      return undefined;
    }
    const targetLanguage = oppositeSubtitleLanguage(source.track.language);
    const translationRequest: AssetArtifactRequest = {
      assetId,
      producerId: MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
      artifactKey: createSubtitleTranslationArtifactKey(
        source.track.language,
        targetLanguage,
      ),
      workspacePath: source.request.workspacePath,
      source: {
        assetId,
        mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
        absolutePath: source.artifact.absolutePath,
        revision: source.artifact.artifact.artifactRevision,
      },
    };
    const translationArtifact = await this.artifacts.getCached(
      translationRequest,
    );
    if (!translationArtifact) return undefined;
    if (
      translationArtifact.artifact.mediaType !==
      SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    const translation = await readSubtitleTranslationTrackFile(
      translationArtifact.absolutePath,
      source.track,
      source.artifact.artifact.artifactRevision,
    );
    const revision = dubbingSourceRevision({
      sourceRevision: source.request.source.revision,
      sourceTrackRevision: source.artifact.artifact.artifactRevision,
      translation,
    });
    return Object.freeze({
      source,
      translation,
      speakerTrackRequest: Object.freeze({
        assetId,
        producerId: DUBBING_SPEAKER_TRACK_PRODUCER_ID,
        artifactKey: DUBBING_SPEAKER_TRACK_ARTIFACT_KEY,
        workspacePath: source.request.workspacePath,
        source: Object.freeze({
          assetId,
          mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
          absolutePath: source.artifact.absolutePath,
          revision: source.artifact.artifact.artifactRevision,
        }),
      }),
      request: Object.freeze({
        assetId,
        producerId: VOXCPM2_DUBBING_PRODUCER_ID,
        artifactKey: createVoxCpm2DubbingArtifactKey(targetLanguage),
        workspacePath: source.request.workspacePath,
        source: Object.freeze({
          ...source.request.source,
          revision,
        }),
      }),
    });
  }

  private async requireTranslation(
    projectId: string,
    assetId: string,
  ): Promise<ReturnType<MediaSubtitleServiceApi['getSnapshot']>> {
    const current = this.subtitles.getSnapshot(assetId);
    if (current.phase === 'ready' && current.translation) return current;

    this.update(assetId, {
      ...EMPTY_SNAPSHOT,
      phase: 'awaiting-translation',
    });
    await this.subtitles.ensureTranslation(projectId, assetId);
    return this.waitForTranslation(assetId);
  }

  private applyRuntimeFailure(assetId: string, error: unknown): boolean {
    if (
      error instanceof AppError &&
      error.code === 'EXTERNAL_LIBRARY_NOT_INSTALLED'
    ) {
      this.update(assetId, {
        ...this.getSnapshot(assetId),
        phase: 'runtime-required',
        message: '请先在设置中安装 VoxCPM2 视频/音频配音组件。',
      });
      return true;
    }
    if (error instanceof AppError && error.code === 'FEATURE_NOT_SUPPORTED') {
      this.update(assetId, {
        ...this.getSnapshot(assetId),
        phase: 'unsupported',
        message: 'VoxCPM2 配音当前仅支持 Windows x64 与 NVIDIA GPU。',
      });
      return true;
    }
    return false;
  }

  private async waitForTranslation(
    assetId: string,
  ): Promise<ReturnType<MediaSubtitleServiceApi['getSnapshot']>> {
    const current = this.subtitles.getSnapshot(assetId);
    if (current.phase === 'ready' && current.translation) return current;
    if (
      current.phase === 'failed' ||
      current.phase === 'runtime-required' ||
      current.phase === 'unsupported-language'
    ) {
      throw new Error(current.message ?? '字幕翻译不可用');
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const unsubscribe = this.subtitles.subscribe(assetId, (event) => {
        if (event.type !== 'snapshot') return;
        if (event.snapshot.phase === 'ready' && event.snapshot.translation) {
          unsubscribe();
          resolvePromise(event.snapshot);
        } else if (
          event.snapshot.phase === 'failed' ||
          event.snapshot.phase === 'runtime-required' ||
          event.snapshot.phase === 'unsupported-language'
        ) {
          unsubscribe();
          rejectPromise(new Error(event.snapshot.message ?? '字幕翻译不可用'));
        }
      });
    });
  }

  private handleProgress(progress: MediaDubbingProgress): void {
    if (
      this.activeRevisions.get(progress.assetId) !== progress.sourceRevision
    ) {
      return;
    }
    if (progress.speakerTrack) {
      this.updateSpeakerTrack(progress.assetId, progress.speakerTrack);
    }
    this.update(progress.assetId, {
      phase: progress.phase,
      completedPhrases: progress.completedPhrases,
      totalPhrases: progress.totalPhrases,
      completedDurationMs: progress.completedDurationMs,
      durationMs: progress.durationMs,
      readySuffixStartMs: progress.readySuffixStartMs,
      ...(progress.previewAudioPath
        ? { previewAudioPath: progress.previewAudioPath }
        : {}),
    });
  }

  private update(assetId: string, snapshot: MediaDubbingServiceSnapshot): void {
    const cloned = cloneSnapshot(snapshot);
    this.snapshots.set(assetId, cloned);
    for (const listener of this.listeners.get(assetId) ?? []) listener(cloned);
  }

  private updateSpeakerTrack(
    assetId: string,
    track: DubbingSpeakerTrackV1 | undefined,
  ): void {
    const cloned = track ? cloneDubbingSpeakerTrack(track) : undefined;
    const current = this.speakerTracks.get(assetId);
    if (
      (!current && !cloned) ||
      (current && cloned && JSON.stringify(current) === JSON.stringify(cloned))
    ) {
      return;
    }
    if (cloned) this.speakerTracks.set(assetId, cloned);
    else this.speakerTracks.delete(assetId);
    for (const listener of this.speakerTrackListeners.get(assetId) ?? []) {
      listener(cloned ? cloneDubbingSpeakerTrack(cloned) : undefined);
    }
  }
}
