import type { AssetArtifactRegistryApi } from '../../../main/artifacts/asset-artifact-registry';
import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../../main/artifacts/asset-artifact-service';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import { createFileContentRevision } from '../../../main/content/content-revision';
import { AppError } from '../../../main/errors/app-error';
import type { ProjectLookup } from '../../../main/projects/project-database';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
  isTranslatableSubtitleLanguage,
  oppositeSubtitleLanguage,
  type SubtitleSourceTrackV1,
} from '../../media-subtitles/contracts';
import type { MediaSubtitleRuntimeResolverApi } from '../../media-subtitles/external-libraries/media-subtitle-runtime';
import {
  MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
  MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID,
  MediaSubtitleTranscriptionProducer,
} from '../../media-subtitles/transcription-producer';
import {
  MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
  MediaSubtitleTranslationProducer,
  createSubtitleTranslationArtifactKey,
  type SubtitleTranslationProgress,
} from '../../media-subtitles/translation-producer';
import {
  readSubtitleSourceTrackFile,
  readSubtitleTranslationTrackFile,
} from '../../media-subtitles/subtitle-artifact-files';
import {
  EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
  type VideoSubtitleCueFinalPayload,
  type VideoSubtitleSnapshot,
  videoWorkbenchManifest,
} from '../shared';

interface ResolvedSourceTrack {
  readonly track: SubtitleSourceTrackV1;
  readonly artifact: ResolvedAssetArtifact;
  readonly workspacePath: string;
}

export type VideoSubtitleServiceEvent =
  | {
      readonly type: 'snapshot';
      readonly snapshot: VideoSubtitleSnapshot;
    }
  | {
      readonly type: 'cue-final';
      readonly payload: VideoSubtitleCueFinalPayload;
    };

export type VideoSubtitleServiceListener = (
  event: VideoSubtitleServiceEvent,
) => void;

export interface VideoSubtitleServiceApi {
  getSnapshot(assetId: string): VideoSubtitleSnapshot;
  subscribe(assetId: string, listener: VideoSubtitleServiceListener): () => void;
  ensureSource(projectId: string, assetId: string): Promise<void>;
  ensureTranslation(projectId: string, assetId: string): Promise<void>;
  retry(projectId: string, assetId: string): Promise<void>;
}

function cloneSnapshot(snapshot: VideoSubtitleSnapshot): VideoSubtitleSnapshot {
  return Object.freeze({
    ...snapshot,
    partialTranslations: Object.freeze([...snapshot.partialTranslations]),
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function userFailureMessage(error: unknown): string {
  if (
    error instanceof AppError &&
    error.code === 'MEDIA_SUBTITLE_PROCESSING_FAILED'
  ) {
    return '字幕处理失败，可以稍后重试。';
  }
  return '字幕处理没有完成。';
}

export class VideoSubtitleService implements VideoSubtitleServiceApi {
  private readonly snapshots = new Map<string, VideoSubtitleSnapshot>();
  private readonly listeners = new Map<
    string,
    Set<VideoSubtitleServiceListener>
  >();
  private readonly sourceTasks = new Map<string, Promise<void>>();
  private readonly translationTasks = new Map<string, Promise<void>>();
  private readonly sourceArtifacts = new Map<string, ResolvedSourceTrack>();
  private sourceQueue: Promise<void> = Promise.resolve();
  private translationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly assets: AssetServiceApi,
    private readonly projects: ProjectLookup,
    private readonly artifacts: AssetArtifactServiceApi,
    artifactRegistry: AssetArtifactRegistryApi,
    private readonly runtimes: MediaSubtitleRuntimeResolverApi,
  ) {
    artifactRegistry.register(new MediaSubtitleTranscriptionProducer(runtimes));
    artifactRegistry.register(
      new MediaSubtitleTranslationProducer(
        runtimes,
        (progress) => this.handleTranslationProgress(progress),
      ),
    );
    assets.subscribe(({ asset }) => {
      if (
        asset.contentStatus.availability === 'available' &&
        videoWorkbenchManifest.supportedMediaTypes.includes(asset.mediaType)
      ) {
        void this.ensureSource(asset.projectId, asset.id);
      }
    });
  }

  getSnapshot(assetId: string): VideoSubtitleSnapshot {
    return cloneSnapshot(
      this.snapshots.get(assetId) ?? EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
    );
  }

  subscribe(
    assetId: string,
    listener: VideoSubtitleServiceListener,
  ): () => void {
    const listeners = this.listeners.get(assetId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(assetId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(assetId);
    };
  }

  async ensureSource(projectId: string, assetId: string): Promise<void> {
    const active = this.sourceTasks.get(assetId);
    if (active) return active;

    this.updateSnapshot(assetId, {
      ...this.getSnapshot(assetId),
      phase: 'queued',
      message: undefined,
    });
    const task = this.sourceQueue
      .catch(() => undefined)
      .then(() => this.prepareSource(projectId, assetId))
      .finally(() => this.sourceTasks.delete(assetId));
    this.sourceTasks.set(assetId, task);
    this.sourceQueue = task;
    return task;
  }

  async ensureTranslation(projectId: string, assetId: string): Promise<void> {
    const active = this.translationTasks.get(assetId);
    if (active) return active;

    const task = this.translationQueue
      .catch(() => undefined)
      .then(async () => {
        await this.ensureSource(projectId, assetId);
        await this.prepareTranslation(projectId, assetId);
      })
      .finally(() => this.translationTasks.delete(assetId));
    this.translationTasks.set(assetId, task);
    this.translationQueue = task;
    return task;
  }

  async retry(projectId: string, assetId: string): Promise<void> {
    if (this.sourceArtifacts.has(assetId)) {
      await this.ensureTranslation(projectId, assetId);
    } else {
      await this.ensureSource(projectId, assetId);
    }
  }

  private async prepareSource(projectId: string, assetId: string): Promise<void> {
    try {
      const request = await this.createSourceRequest(projectId, assetId);
      this.updateSnapshot(assetId, {
        ...this.getSnapshot(assetId),
        phase: 'transcribing',
        message: undefined,
      });
      const artifact = await this.artifacts.getOrCreate(request);
      if (artifact.artifact.mediaType !== SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const track = await readSubtitleSourceTrackFile(artifact.absolutePath);
      if (track.sourceRevision !== artifact.artifact.sourceRevision) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const resolved = { track, artifact, workspacePath: request.workspacePath };
      this.sourceArtifacts.set(assetId, resolved);
      this.updateSnapshot(assetId, {
        phase: 'source-ready',
        source: track,
        partialTranslations: [],
        completedCues: 0,
        totalCues: track.cues.length,
      });
    } catch (error) {
      if (isAbortError(error)) return;
      if (
        error instanceof AppError &&
        error.code === 'EXTERNAL_LIBRARY_NOT_INSTALLED'
      ) {
        this.updateSnapshot(assetId, {
          ...this.getSnapshot(assetId),
          phase: 'runtime-required',
          message: '请先在设置中安装视频/音频字幕组件。',
        });
        return;
      }
      if (
        error instanceof AppError &&
        (error.code === 'ASSET_NOT_FOUND' ||
          error.code === 'PROJECT_CONTEXT_CHANGED' ||
          error.code === 'OPERATION_SUPERSEDED')
      ) {
        return;
      }
      this.updateSnapshot(assetId, {
        ...this.getSnapshot(assetId),
        phase: 'failed',
        message: userFailureMessage(error),
      });
    }
  }

  private async prepareTranslation(
    projectId: string,
    assetId: string,
  ): Promise<void> {
    const source = this.sourceArtifacts.get(assetId);
    if (!source) return;
    if (!isTranslatableSubtitleLanguage(source.track.language)) {
      this.updateSnapshot(assetId, {
        ...this.getSnapshot(assetId),
        phase: 'unsupported-language',
        message: '当前字幕语言不是可自动翻译的中文或英文。',
      });
      return;
    }

    const targetLanguage = oppositeSubtitleLanguage(source.track.language);
    const sourceTrackRevision = source.artifact.artifact.artifactRevision;
    const request: AssetArtifactRequest = {
      assetId,
      producerId: MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
      artifactKey: createSubtitleTranslationArtifactKey(
        source.track.language,
        targetLanguage,
      ),
      workspacePath: source.workspacePath,
      source: {
        assetId,
        mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
        absolutePath: source.artifact.absolutePath,
        revision: sourceTrackRevision,
      },
    };
    this.updateSnapshot(assetId, {
      ...this.getSnapshot(assetId),
      phase: 'translating',
      translation: undefined,
      partialTranslations: [],
      completedCues: 0,
      totalCues: source.track.cues.length,
      message: undefined,
    });

    try {
      const artifact = await this.artifacts.getOrCreate(request);
      if (
        artifact.artifact.mediaType !==
        SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const translation = await readSubtitleTranslationTrackFile(
        artifact.absolutePath,
        source.track,
        sourceTrackRevision,
      );
      this.updateSnapshot(assetId, {
        ...this.getSnapshot(assetId),
        phase: 'ready',
        translation,
        partialTranslations: translation.cues,
        completedCues: translation.cues.length,
        totalCues: translation.cues.length,
        message: undefined,
      });
    } catch (error) {
      if (isAbortError(error)) return;
      if (
        error instanceof AppError &&
        error.code === 'EXTERNAL_LIBRARY_NOT_INSTALLED'
      ) {
        this.updateSnapshot(assetId, {
          ...this.getSnapshot(assetId),
          phase: 'runtime-required',
          message: '请先在设置中安装视频/音频字幕组件。',
        });
        return;
      }
      this.updateSnapshot(assetId, {
        ...this.getSnapshot(assetId),
        phase: 'failed',
        message: userFailureMessage(error),
      });
    }
  }

  private async createSourceRequest(
    projectId: string,
    assetId: string,
  ): Promise<AssetArtifactRequest> {
    const asset = this.assets.get(assetId);
    const project = this.projects.get(projectId);
    if (!asset || asset.projectId !== projectId) {
      throw new AppError('ASSET_NOT_FOUND');
    }
    if (!project) throw new AppError('PROJECT_NOT_FOUND');
    if (!videoWorkbenchManifest.supportedMediaTypes.includes(asset.mediaType)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    await this.runtimes.requireTranscription();

    const content = await this.assets.resolveContent(assetId);
    try {
      if (
        content.contentStatus.availability !== 'available' ||
        content.location?.kind !== 'local-file'
      ) {
        throw new AppError('ASSET_UNAVAILABLE');
      }
      const revision = await createFileContentRevision(
        content.location.absolutePath,
      );
      return {
        assetId,
        producerId: MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID,
        artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
        workspacePath: project.workspacePath,
        source: {
          assetId,
          mediaType: asset.mediaType,
          absolutePath: content.location.absolutePath,
          revision,
        },
      };
    } finally {
      await content.handle?.close();
    }
  }

  private handleTranslationProgress(progress: SubtitleTranslationProgress): void {
    const source = this.sourceArtifacts.get(progress.assetId);
    if (
      !source ||
      source.artifact.artifact.artifactRevision !==
        progress.sourceTrackRevision
    ) {
      return;
    }
    const current = this.getSnapshot(progress.assetId);
    const translations = new Map(
      current.partialTranslations.map((cue) => [cue.sourceCueId, cue]),
    );
    translations.set(progress.cue.sourceCueId, progress.cue);
    const ordered = source.track.cues.flatMap((cue) => {
      const translated = translations.get(cue.id);
      return translated ? [translated] : [];
    });
    this.snapshots.set(progress.assetId, cloneSnapshot({
      ...current,
      phase: 'translating',
      partialTranslations: ordered,
      completedCues: progress.completedCues,
      totalCues: progress.totalCues,
    }));
    this.publish(progress.assetId, {
      type: 'cue-final',
      payload: {
        sourceTrackRevision: progress.sourceTrackRevision,
        cue: progress.cue,
        completedCues: progress.completedCues,
        totalCues: progress.totalCues,
      },
    });
  }

  private updateSnapshot(assetId: string, snapshot: VideoSubtitleSnapshot): void {
    const cloned = cloneSnapshot(snapshot);
    this.snapshots.set(assetId, cloned);
    this.publish(assetId, { type: 'snapshot', snapshot: cloned });
  }

  private publish(assetId: string, event: VideoSubtitleServiceEvent): void {
    for (const listener of this.listeners.get(assetId) ?? []) {
      listener(event);
    }
  }
}
