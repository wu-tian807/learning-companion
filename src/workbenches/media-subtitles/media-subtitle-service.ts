import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import type { AssetServiceApi } from '../../main/assets/asset-service';
import { AppError, describeAppError } from '../../main/errors/app-error';
import type { GenerationTaskSnapshot } from '../../main/generation/generation-task';
import type { GenerationTaskServiceApi } from '../../main/generation/generation-task-service';
import type { ProjectLookup } from '../../main/projects/project-database';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
  isTranslatableSubtitleLanguage,
  oppositeSubtitleLanguage,
  type SubtitleSourceTrackV1,
  type SubtitleTranslationTrackV1,
} from './contracts';
import type { MediaSubtitleRuntimeResolverApi } from './external-libraries/media-subtitle-runtime';
import {
  MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
  createSubtitleTranslationArtifactKey,
  type SubtitleTranslationProgressHub,
  type SubtitleTranslationProgress,
} from './translation-producer';
import {
  SUBTITLE_TRANSLATION_TASK_DEFINITION_ID,
  SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION,
  SubtitleTranslationInstruction,
  subtitleTranslationInstructionFactory,
} from './generation/subtitle-translation-instruction';
import {
  readSubtitleSourceTrackFile,
  readSubtitleTranslationTrackFile,
} from './subtitle-artifact-files';
import { createMediaSubtitleSourceArtifactRequest } from './subtitle-source-artifact';
import {
  EMPTY_MEDIA_SUBTITLE_SNAPSHOT,
  type MediaSubtitleCueFinalPayload,
  type MediaSubtitleSnapshot,
} from './presentation';
import type { MediaSubtitleSourceTaskQueueApi } from './source-task-queue';
import type {
  SubtitleTranscriptionProgress,
  SubtitleTranscriptionProgressHub,
} from './transcription-progress';
import {
  MEDIA_SUBTITLE_SOURCE_SRT_ARTIFACT_KEY,
  createSubtitleSrtArtifactRequest,
  createSubtitleTranslationSrtArtifactKey,
  type MediaSubtitleSrtProducerApi,
} from './subtitle-srt-artifact';

interface ResolvedSourceTrack {
  readonly track: SubtitleSourceTrackV1;
  readonly artifact: ResolvedAssetArtifact;
  readonly workspacePath: string;
}

interface ActiveTranslationTask {
  readonly assetId: string;
  readonly request: AssetArtifactRequest;
}

export type MediaSubtitleServiceEvent =
  | {
      readonly type: 'snapshot';
      readonly snapshot: MediaSubtitleSnapshot;
    }
  | {
      readonly type: 'cue-final';
      readonly payload: MediaSubtitleCueFinalPayload;
    };

export type MediaSubtitleServiceListener = (
  event: MediaSubtitleServiceEvent,
) => void;

export interface MediaSubtitleServiceApi {
  getSnapshot(assetId: string): MediaSubtitleSnapshot;
  subscribe(
    assetId: string,
    listener: MediaSubtitleServiceListener,
  ): () => void;
  ensureSource(projectId: string, assetId: string): Promise<void>;
  ensureTranslation(projectId: string, assetId: string): Promise<void>;
  retry(projectId: string, assetId: string): Promise<void>;
}

type SourceRequestPriority = 'interactive' | 'background';

function cloneSnapshot(snapshot: MediaSubtitleSnapshot): MediaSubtitleSnapshot {
  return Object.freeze({
    ...snapshot,
    partialTranslations: Object.freeze([...snapshot.partialTranslations]),
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function userFailureMessage(error: unknown): string {
  const described = describeAppError(error);
  if (described.userMessage) return described.userMessage;
  if (
    error instanceof AppError &&
    error.code === 'MEDIA_SUBTITLE_PROCESSING_FAILED'
  ) {
    return '字幕处理失败，可以稍后重试。';
  }
  return '字幕处理没有完成。';
}

const PROVIDER_AUTH_FAILURE_DETAIL_PATTERN =
  /(?:\b(?:401|403)\b|unauthori[sz]ed|forbidden|invalid[_ -]?api[_ -]?key|incorrect api key|authentication (?:failed|required)|api key.*(?:invalid|expired|missing))/iu;

function translationProviderFailureMessage(
  code: string | undefined,
  detail?: string,
): string | undefined {
  if (
    code === 'AGENT_PROVIDER_AUTH_REQUIRED' ||
    (code === 'CODEX_REQUEST_FAILED' &&
      detail !== undefined &&
      PROVIDER_AUTH_FAILURE_DETAIL_PATTERN.test(detail))
  ) {
    return '“低智能”翻译连接未通过验证。请在设置中完成登录，或配置有效的 API Key。';
  }
  if (code === 'AGENT_PROVIDER_SELECTION_REQUIRED') {
    return '尚未为“低智能”选择可用的 AI Provider。请先在设置中完成配置。';
  }
  return '“低智能”当前选择的 AI Provider 不可用。请在设置中重新选择。';
}

function translationFailureSnapshot(
  snapshot: MediaSubtitleSnapshot,
  error: unknown,
): MediaSubtitleSnapshot {
  const described = describeAppError(error);
  const providerMessage = translationProviderFailureMessage(
    described.code,
    described.detail,
  );
  return {
    ...snapshot,
    phase: providerMessage ? 'provider-required' : 'failed',
    message: providerMessage ?? userFailureMessage(error),
  };
}

export class MediaSubtitleService implements MediaSubtitleServiceApi {
  private readonly snapshots = new Map<string, MediaSubtitleSnapshot>();
  private readonly listeners = new Map<
    string,
    Set<MediaSubtitleServiceListener>
  >();
  private readonly sourceTasks = new Map<string, Promise<void>>();
  private readonly translationTasks = new Map<string, Promise<void>>();
  private readonly sourceArtifacts = new Map<string, ResolvedSourceTrack>();
  private readonly activeSourceRevisions = new Map<string, string>();
  private readonly activeTranslationTasks = new Map<
    string,
    ActiveTranslationTask
  >();
  private readonly supportedMediaTypes: ReadonlySet<string>;

  constructor(
    private readonly assets: AssetServiceApi,
    private readonly projects: ProjectLookup,
    private readonly artifacts: AssetArtifactServiceApi,
    private readonly srtProducer: MediaSubtitleSrtProducerApi,
    private readonly runtimes: MediaSubtitleRuntimeResolverApi,
    private readonly sourceTaskQueue: MediaSubtitleSourceTaskQueueApi,
    private readonly generationTasks: GenerationTaskServiceApi,
    translationProgress: SubtitleTranslationProgressHub,
    supportedMediaTypes: readonly string[],
    transcriptionProgress?: SubtitleTranscriptionProgressHub,
  ) {
    this.supportedMediaTypes = new Set(supportedMediaTypes);
    translationProgress.subscribe((progress) =>
      this.handleTranslationProgress(progress),
    );
    transcriptionProgress?.subscribe((progress) =>
      this.handleTranscriptionProgress(progress),
    );
    generationTasks.subscribe((event) => {
      if (event.type === 'task-completed') {
        void this.completeTranslationTask(event.snapshot.id);
      } else if (
        event.type === 'task-changed' &&
        (event.snapshot.failure || event.snapshot.cancelledTime !== undefined)
      ) {
        this.failTranslationTask(event.snapshot);
      }
    });
    assets.subscribe(({ asset }) => {
      if (
        asset.contentStatus.availability === 'available' &&
        this.supportedMediaTypes.has(asset.mediaType)
      ) {
        void this.ensureSourceWithPriority(
          asset.projectId,
          asset.id,
          'background',
        );
      }
    });
  }

  getSnapshot(assetId: string): MediaSubtitleSnapshot {
    return cloneSnapshot(
      this.snapshots.get(assetId) ?? EMPTY_MEDIA_SUBTITLE_SNAPSHOT,
    );
  }

  subscribe(
    assetId: string,
    listener: MediaSubtitleServiceListener,
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
    return this.ensureSourceWithPriority(projectId, assetId, 'interactive');
  }

  private async ensureSourceWithPriority(
    projectId: string,
    assetId: string,
    priority: SourceRequestPriority,
  ): Promise<void> {
    const active = this.sourceTasks.get(assetId);
    if (active) {
      if (priority === 'interactive') this.sourceTaskQueue.promote(assetId);
      return active;
    }

    this.updateSnapshot(assetId, {
      ...this.getSnapshot(assetId),
      phase: 'queued',
      message: undefined,
    });
    const task = this.sourceTaskQueue
      .enqueue(
        assetId,
        () => this.prepareSource(projectId, assetId),
        priority,
      )
      .finally(() => this.sourceTasks.delete(assetId));
    this.sourceTasks.set(assetId, task);
    return task;
  }

  async ensureTranslation(projectId: string, assetId: string): Promise<void> {
    const active = this.translationTasks.get(assetId);
    if (active) return active;

    const task = (async () => {
      try {
        await this.ensureSource(projectId, assetId);
        await this.prepareTranslation(projectId, assetId);
      } catch (error) {
        if (isAbortError(error)) return;
        if (
          error instanceof AppError &&
          (error.code === 'ASSET_NOT_FOUND' ||
            error.code === 'PROJECT_CONTEXT_CHANGED' ||
            error.code === 'OPERATION_SUPERSEDED')
        ) {
          return;
        }
        this.updateSnapshot(
          assetId,
          translationFailureSnapshot(this.getSnapshot(assetId), error),
        );
      }
    })().finally(() => this.translationTasks.delete(assetId));
    this.translationTasks.set(assetId, task);
    return task;
  }

  async retry(projectId: string, assetId: string): Promise<void> {
    if (this.sourceArtifacts.has(assetId)) {
      await this.ensureTranslation(projectId, assetId);
    } else {
      await this.ensureSource(projectId, assetId);
    }
  }

  private async prepareSource(
    projectId: string,
    assetId: string,
  ): Promise<void> {
    let activeRevision: string | undefined;
    try {
      const request = await this.createSourceRequest(projectId, assetId);
      activeRevision = request.source.revision;
      this.activeSourceRevisions.set(assetId, activeRevision);
      this.updateSnapshot(assetId, {
        ...this.getSnapshot(assetId),
        phase: 'transcribing',
        sourceTrackRevision: undefined,
        message: '正在生成原文字幕…',
      });
      const artifact = await this.artifacts.getOrCreate(request);
      if (artifact.artifact.mediaType !== SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const track = await readSubtitleSourceTrackFile(artifact.absolutePath);
      if (track.sourceRevision !== artifact.artifact.sourceRevision) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const resolved = {
        track,
        artifact,
        workspacePath: request.workspacePath,
      };
      await this.materializeSourceSrt(assetId, resolved);
      this.sourceArtifacts.set(assetId, resolved);
      this.updateSnapshot(assetId, {
        phase: 'source-ready',
        source: track,
        sourceTrackRevision: artifact.artifact.artifactRevision,
        partialTranslations: [],
        completedCues: 0,
        totalCues: track.cues.length,
      });
      await this.restoreCachedTranslation(assetId, resolved);
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
    } finally {
      if (
        activeRevision !== undefined &&
        this.activeSourceRevisions.get(assetId) === activeRevision
      ) {
        this.activeSourceRevisions.delete(assetId);
      }
    }
  }

  private handleTranscriptionProgress(
    progress: SubtitleTranscriptionProgress,
  ): void {
    if (
      this.activeSourceRevisions.get(progress.assetId) !==
      progress.sourceRevision
    ) {
      return;
    }
    const count = progress.track.cues.length;
    this.updateSnapshot(progress.assetId, {
      phase: 'transcribing',
      source: progress.track,
      partialTranslations: [],
      completedCues: count,
      totalCues: count,
      message:
        progress.stage === 'diarizing'
          ? `原文字幕已生成 ${count} 段，正在识别说话人…`
          : `原文字幕已生成 ${count} 段，正在继续处理…`,
    });
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
    const request = this.createTranslationRequest(assetId, source);
    if (await this.restoreCachedTranslation(assetId, source, request)) return;

    this.updateSnapshot(assetId, {
      ...this.getSnapshot(assetId),
      phase: 'translating',
      translation: undefined,
      partialTranslations: [],
      completedCues: 0,
      totalCues: source.track.cues.length,
      message: undefined,
    });

    const existing = this.findTranslationTask(
      assetId,
      sourceTrackRevision,
      source.track.language,
      targetLanguage,
    );
    const snapshot = existing?.failure
      ? this.generationTasks.retry(existing.id)
      : (existing ??
        this.generationTasks.start({
          projectId,
          definitionId: SUBTITLE_TRANSLATION_TASK_DEFINITION_ID,
          definitionVersion: SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION,
          instruction: new SubtitleTranslationInstruction({
            assetId,
            sourceTrackRevision,
            sourceLanguage: source.track.language,
            targetLanguage,
          }).toSnapshot(),
          assetReferences: Object.freeze({}),
        }));
    this.activeTranslationTasks.set(snapshot.id, {
      assetId,
      request,
    });
    if (snapshot.completed) {
      await this.completeTranslationTask(snapshot.id);
    }
  }

  private async createSourceRequest(
    projectId: string,
    assetId: string,
  ): Promise<AssetArtifactRequest> {
    const asset = this.assets.get(assetId);
    if (!asset || asset.projectId !== projectId) {
      throw new AppError('ASSET_NOT_FOUND');
    }
    if (!this.supportedMediaTypes.has(asset.mediaType)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    await this.runtimes.requireTranscription();
    return createMediaSubtitleSourceArtifactRequest(
      this.assets,
      this.projects,
      projectId,
      assetId,
    );
  }

  private findTranslationTask(
    assetId: string,
    sourceTrackRevision: string,
    sourceLanguage: 'en' | 'zh-Hans',
    targetLanguage: 'en' | 'zh-Hans',
  ): GenerationTaskSnapshot | undefined {
    return this.generationTasks.list().find((snapshot) => {
      if (
        snapshot.definitionId !== SUBTITLE_TRANSLATION_TASK_DEFINITION_ID ||
        snapshot.definitionVersion !==
          SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION ||
        snapshot.cancelledTime !== undefined
      ) {
        return false;
      }
      const parsed = subtitleTranslationInstructionFactory.parse(
        snapshot.instruction,
      );
      return (
        parsed.ok &&
        parsed.value.assetId === assetId &&
        parsed.value.sourceTrackRevision === sourceTrackRevision &&
        parsed.value.sourceLanguage === sourceLanguage &&
        parsed.value.targetLanguage === targetLanguage
      );
    });
  }

  private async completeTranslationTask(taskId: string): Promise<void> {
    const active = this.activeTranslationTasks.get(taskId);
    if (!active) return;
    const source = this.sourceArtifacts.get(active.assetId);
    if (!source) return;
    try {
      const artifact = await this.artifacts.getCached(active.request);
      if (!artifact) throw new AppError('DATA_INTEGRITY_ERROR');
      await this.applyTranslationArtifact(active.assetId, source, artifact);
      this.activeTranslationTasks.delete(taskId);
    } catch (error) {
      if (isAbortError(error)) return;
      this.activeTranslationTasks.delete(taskId);
      this.updateSnapshot(active.assetId, {
        ...this.getSnapshot(active.assetId),
        phase: 'failed',
        message: userFailureMessage(error),
      });
    }
  }

  private failTranslationTask(snapshot: GenerationTaskSnapshot): void {
    const active = this.activeTranslationTasks.get(snapshot.id);
    if (!active) return;
    this.activeTranslationTasks.delete(snapshot.id);
    if (snapshot.cancelledTime !== undefined) return;
    const providerMessage = translationProviderFailureMessage(
      snapshot.failure?.code,
      snapshot.failure?.detail,
    );
    this.updateSnapshot(active.assetId, {
      ...this.getSnapshot(active.assetId),
      phase: providerMessage ? 'provider-required' : 'failed',
      message:
        providerMessage ?? snapshot.failure?.message ?? '字幕翻译没有完成。',
    });
  }

  private createTranslationRequest(
    assetId: string,
    source: ResolvedSourceTrack,
  ): AssetArtifactRequest {
    if (!isTranslatableSubtitleLanguage(source.track.language)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    return {
      assetId,
      producerId: MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
      artifactKey: createSubtitleTranslationArtifactKey(
        source.track.language,
        oppositeSubtitleLanguage(source.track.language),
      ),
      workspacePath: source.workspacePath,
      source: {
        assetId,
        mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
        absolutePath: source.artifact.absolutePath,
        revision: source.artifact.artifact.artifactRevision,
      },
    };
  }

  private async restoreCachedTranslation(
    assetId: string,
    source: ResolvedSourceTrack,
    request?: AssetArtifactRequest,
  ): Promise<boolean> {
    if (!isTranslatableSubtitleLanguage(source.track.language)) return false;
    const cached = await this.artifacts.getCached(
      request ?? this.createTranslationRequest(assetId, source),
    );
    if (!cached) return false;
    await this.applyTranslationArtifact(assetId, source, cached);
    return true;
  }

  private async applyTranslationArtifact(
    assetId: string,
    source: ResolvedSourceTrack,
    artifact: ResolvedAssetArtifact,
  ): Promise<void> {
    if (
      artifact.artifact.mediaType !== SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    const translation = await readSubtitleTranslationTrackFile(
      artifact.absolutePath,
      source.track,
      source.artifact.artifact.artifactRevision,
    );
    await this.materializeTranslationSrt(
      assetId,
      source,
      artifact,
      translation,
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
  }

  private async materializeSourceSrt(
    assetId: string,
    source: ResolvedSourceTrack,
  ): Promise<void> {
    await this.srtProducer.materialize(
      this.artifacts,
      createSubtitleSrtArtifactRequest(
        assetId,
        source.workspacePath,
        source.artifact,
        MEDIA_SUBTITLE_SOURCE_SRT_ARTIFACT_KEY,
      ),
      source.track.cues,
    );
  }

  private async materializeTranslationSrt(
    assetId: string,
    source: ResolvedSourceTrack,
    artifact: ResolvedAssetArtifact,
    translation: SubtitleTranslationTrackV1,
  ): Promise<void> {
    await this.srtProducer.materialize(
      this.artifacts,
      createSubtitleSrtArtifactRequest(
        assetId,
        source.workspacePath,
        artifact,
        createSubtitleTranslationSrtArtifactKey(
          translation.sourceLanguage,
          translation.targetLanguage,
        ),
      ),
      source.track.cues.map((cue, index) =>
        Object.freeze({
          startMs: cue.startMs,
          endMs: cue.endMs,
          text: translation.cues[index]!.text,
        }),
      ),
    );
  }

  private handleTranslationProgress(
    progress: SubtitleTranslationProgress,
  ): void {
    const source = this.sourceArtifacts.get(progress.assetId);
    if (
      !source ||
      source.artifact.artifact.artifactRevision !== progress.sourceTrackRevision
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
    this.snapshots.set(
      progress.assetId,
      cloneSnapshot({
        ...current,
        phase: 'translating',
        partialTranslations: ordered,
        completedCues: progress.completedCues,
        totalCues: progress.totalCues,
      }),
    );
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

  private updateSnapshot(
    assetId: string,
    snapshot: MediaSubtitleSnapshot,
  ): void {
    const cloned = cloneSnapshot(snapshot);
    this.snapshots.set(assetId, cloned);
    this.publish(assetId, { type: 'snapshot', snapshot: cloned });
  }

  private publish(assetId: string, event: MediaSubtitleServiceEvent): void {
    for (const listener of this.listeners.get(assetId) ?? []) {
      listener(event);
    }
  }
}
