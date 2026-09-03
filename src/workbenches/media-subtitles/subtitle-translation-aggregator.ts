import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import { AppError } from '../../main/errors/app-error';
import type { GenerationTaskSnapshot } from '../../main/generation/generation-task';
import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
} from '../../main/generation/generation-task-service';
import {
  type SubtitleSourceTrackV1,
  type SubtitleTranslationTrackV1,
  type TranslatableSubtitleLanguage,
} from './contracts';
import {
  SUBTITLE_TRANSLATION_TASK_DEFINITION_ID,
  SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION,
  SubtitleTranslationInstruction,
  subtitleTranslationInstructionFactory,
} from './generation/subtitle-translation-instruction';
import {
  splitSubtitleTranslationChunks,
  type SubtitleTranslationChunk,
} from './generation/subtitle-translation-task-definition';
import {
  createSubtitleTranslationChunkArtifactRequest,
  readSubtitleTranslationChunkArtifact,
  type SubtitleTranslationChunkArtifactV1,
} from './translation-chunk-artifact';
import {
  MediaSubtitleTranslationProducer,
  SubtitleTranslationProgressHub,
} from './translation-producer';

const TRANSLATION_TASK_CONCURRENCY = 3;

export interface SubtitleTranslationAggregationSource {
  readonly track: SubtitleSourceTrackV1;
  readonly artifact: ResolvedAssetArtifact;
  readonly workspacePath: string;
}

export interface SubtitleTranslationAggregationRequest {
  readonly projectId: string;
  readonly assetId: string;
  readonly source: SubtitleTranslationAggregationSource;
  readonly sourceLanguage: TranslatableSubtitleLanguage;
  readonly targetLanguage: TranslatableSubtitleLanguage;
  readonly finalArtifactRequest: AssetArtifactRequest;
}

export type SubtitleTranslationAggregationEvent =
  | {
      readonly type: 'completed';
      readonly assetId: string;
      readonly sourceTrackRevision: string;
      readonly artifact: ResolvedAssetArtifact;
    }
  | {
      readonly type: 'failed';
      readonly assetId: string;
      readonly sourceTrackRevision: string;
      readonly task?: GenerationTaskSnapshot;
      readonly error?: unknown;
    };

export type SubtitleTranslationAggregationListener = (
  event: SubtitleTranslationAggregationEvent,
) => void;

interface TranslationGroup {
  readonly key: string;
  readonly request: SubtitleTranslationAggregationRequest;
  readonly chunks: readonly SubtitleTranslationChunk[];
  readonly completedChunks: Map<number, SubtitleTranslationChunkArtifactV1>;
  readonly activeTasks: Map<number, string>;
  readonly failedTasks: Map<number, GenerationTaskSnapshot>;
  finalizing?: Promise<void>;
  failurePublished: boolean;
  cancelled: boolean;
}

interface TranslationTaskOwner {
  readonly groupKey: string;
  readonly chunkIndex: number;
}

function createGroupKey(
  request: SubtitleTranslationAggregationRequest,
): string {
  return JSON.stringify([
    request.projectId,
    request.assetId,
    request.source.artifact.artifact.artifactRevision,
    request.sourceLanguage,
    request.targetLanguage,
  ]);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export class SubtitleTranslationTaskAggregator {
  private readonly groups = new Map<string, TranslationGroup>();
  private readonly activeGroupByAsset = new Map<string, string>();
  private readonly taskOwners = new Map<string, TranslationTaskOwner>();
  private readonly listeners =
    new Set<SubtitleTranslationAggregationListener>();
  private readonly now: () => number;

  constructor(
    private readonly artifacts: AssetArtifactServiceApi,
    private readonly generationTasks: GenerationTaskServiceApi,
    private readonly producer: MediaSubtitleTranslationProducer,
    private readonly progress: SubtitleTranslationProgressHub,
    dependencies: { readonly now?: () => number } = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    generationTasks.subscribe((event) => {
      void this.handleTaskEvent(event);
    });
  }

  subscribe(listener: SubtitleTranslationAggregationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  cancel(assetId: string): void {
    this.cancelSupersededGroups(assetId, '');
  }

  async ensure(request: SubtitleTranslationAggregationRequest): Promise<void> {
    const key = createGroupKey(request);
    this.cancelSupersededGroups(request.assetId, key);
    let group = this.groups.get(key);
    if (!group) {
      group = {
        key,
        request,
        chunks: splitSubtitleTranslationChunks(request.source.track.cues),
        completedChunks: new Map(),
        activeTasks: new Map(),
        failedTasks: new Map(),
        failurePublished: false,
        cancelled: false,
      };
      this.groups.set(key, group);
      this.activeGroupByAsset.set(request.assetId, key);
      await this.restoreGroup(group);
    }

    group.failurePublished = false;
    await this.schedule(group, true);
  }

  private cancelSupersededGroups(assetId: string, nextKey: string): void {
    const activeKey = this.activeGroupByAsset.get(assetId);
    if (!activeKey || activeKey === nextKey) return;
    const group = this.groups.get(activeKey);
    if (group) {
      group.cancelled = true;
      for (const taskId of group.activeTasks.values()) {
        const snapshot = this.generationTasks.get(taskId);
        if (
          snapshot &&
          !snapshot.completed &&
          snapshot.cancelledTime === undefined
        ) {
          this.generationTasks.cancel(taskId);
        }
        this.taskOwners.delete(taskId);
      }
      this.groups.delete(activeKey);
    }
    this.activeGroupByAsset.delete(assetId);
  }

  private async restoreGroup(group: TranslationGroup): Promise<void> {
    await Promise.all(
      group.chunks.map(async (chunk) => {
        const restored = await this.readCachedChunk(group, chunk);
        if (restored) group.completedChunks.set(chunk.index, restored);
      }),
    );
    this.publishRestoredProgress(group);

    for (const snapshot of this.generationTasks.list()) {
      const owner = this.matchTaskToGroup(snapshot, group);
      if (!owner || group.completedChunks.has(owner.chunkIndex)) continue;
      if (snapshot.failure) {
        group.failedTasks.set(owner.chunkIndex, snapshot);
      } else if (snapshot.cancelledTime === undefined) {
        group.activeTasks.set(owner.chunkIndex, snapshot.id);
        this.taskOwners.set(snapshot.id, owner);
      }
    }
  }

  private publishRestoredProgress(group: TranslationGroup): void {
    let completedCues = 0;
    for (const chunk of group.chunks) {
      const restored = group.completedChunks.get(chunk.index);
      if (!restored) continue;
      for (const cue of restored.cues) {
        completedCues += 1;
        this.progress.publish({
          assetId: group.request.assetId,
          sourceTrackRevision:
            group.request.source.artifact.artifact.artifactRevision,
          cue,
          completedCues,
          totalCues: group.request.source.track.cues.length,
        });
      }
    }
  }

  private matchTaskToGroup(
    snapshot: GenerationTaskSnapshot,
    group: TranslationGroup,
  ): TranslationTaskOwner | undefined {
    if (
      snapshot.projectId !== group.request.projectId ||
      snapshot.definitionId !== SUBTITLE_TRANSLATION_TASK_DEFINITION_ID ||
      snapshot.definitionVersion !==
        SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION
    ) {
      return undefined;
    }
    const parsed = subtitleTranslationInstructionFactory.parse(
      snapshot.instruction,
    );
    if (
      !parsed.ok ||
      parsed.value.assetId !== group.request.assetId ||
      parsed.value.sourceTrackRevision !==
        group.request.source.artifact.artifact.artifactRevision ||
      parsed.value.sourceLanguage !== group.request.sourceLanguage ||
      parsed.value.targetLanguage !== group.request.targetLanguage ||
      !group.chunks[parsed.value.chunkIndex]
    ) {
      return undefined;
    }
    return Object.freeze({
      groupKey: group.key,
      chunkIndex: parsed.value.chunkIndex,
    });
  }

  private async schedule(
    group: TranslationGroup,
    retryFailures: boolean,
  ): Promise<void> {
    if (group.cancelled || group.finalizing) return;
    if (group.completedChunks.size === group.chunks.length) {
      this.startFinalization(group);
      return;
    }

    if (!group.completedChunks.has(0)) {
      if (!group.activeTasks.has(0)) {
        const failed = group.failedTasks.get(0);
        if (!failed || retryFailures) this.startChunkTask(group, 0, failed);
      }
      this.publishFailureIfIdle(group);
      return;
    }

    for (const chunk of group.chunks.slice(1)) {
      if (group.activeTasks.size >= TRANSLATION_TASK_CONCURRENCY) break;
      if (
        group.completedChunks.has(chunk.index) ||
        group.activeTasks.has(chunk.index)
      ) {
        continue;
      }
      const failed = group.failedTasks.get(chunk.index);
      if (failed && !retryFailures) continue;
      this.startChunkTask(group, chunk.index, failed);
    }
    this.publishFailureIfIdle(group);
  }

  private startChunkTask(
    group: TranslationGroup,
    chunkIndex: number,
    failed?: GenerationTaskSnapshot,
  ): void {
    group.failedTasks.delete(chunkIndex);
    const snapshot = failed
      ? this.generationTasks.retry(failed.id)
      : this.generationTasks.start({
          projectId: group.request.projectId,
          definitionId: SUBTITLE_TRANSLATION_TASK_DEFINITION_ID,
          definitionVersion: SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION,
          instruction: new SubtitleTranslationInstruction({
            assetId: group.request.assetId,
            sourceTrackRevision:
              group.request.source.artifact.artifact.artifactRevision,
            sourceLanguage: group.request.sourceLanguage,
            targetLanguage: group.request.targetLanguage,
            chunkIndex,
          }).toSnapshot(),
          assetReferences: Object.freeze({}),
        });
    group.activeTasks.set(chunkIndex, snapshot.id);
    this.taskOwners.set(snapshot.id, {
      groupKey: group.key,
      chunkIndex,
    });
  }

  private async handleTaskEvent(
    event: GenerationTaskServiceEvent,
  ): Promise<void> {
    if (event.type === 'task-discarded' || event.type === 'execution-event') {
      return;
    }
    const owner =
      this.taskOwners.get(event.snapshot.id) ??
      this.findOwner(event.snapshot);
    if (!owner) return;
    const group = this.groups.get(owner.groupKey);
    if (!group || group.cancelled) return;

    if (event.type === 'task-completed') {
      group.activeTasks.delete(owner.chunkIndex);
      group.failedTasks.delete(owner.chunkIndex);
      this.taskOwners.delete(event.snapshot.id);
      const chunk = group.chunks[owner.chunkIndex];
      if (!chunk) return;
      try {
        const completed = await this.readCachedChunk(group, chunk);
        if (!completed) throw new AppError('DATA_INTEGRITY_ERROR');
        group.completedChunks.set(owner.chunkIndex, completed);
        this.publishChunkProgress(group, completed);
        await this.schedule(group, false);
      } catch (error) {
        this.publish({
          type: 'failed',
          assetId: group.request.assetId,
          sourceTrackRevision:
            group.request.source.artifact.artifact.artifactRevision,
          error,
        });
      }
      return;
    }

    if (event.snapshot.failure || event.snapshot.cancelledTime !== undefined) {
      group.activeTasks.delete(owner.chunkIndex);
      this.taskOwners.delete(event.snapshot.id);
      if (event.snapshot.failure) {
        group.failedTasks.set(owner.chunkIndex, event.snapshot);
      }
      await this.schedule(group, false);
    }
  }

  private findOwner(
    snapshot: GenerationTaskSnapshot,
  ): TranslationTaskOwner | undefined {
    for (const group of this.groups.values()) {
      const owner = this.matchTaskToGroup(snapshot, group);
      if (owner) return owner;
    }
    return undefined;
  }

  private async readCachedChunk(
    group: TranslationGroup,
    chunk: SubtitleTranslationChunk,
  ): Promise<SubtitleTranslationChunkArtifactV1 | undefined> {
    const request = createSubtitleTranslationChunkArtifactRequest({
      assetId: group.request.assetId,
      workspacePath: group.request.source.workspacePath,
      sourceArtifact: group.request.source.artifact,
      sourceLanguage: group.request.sourceLanguage,
      targetLanguage: group.request.targetLanguage,
      chunkIndex: chunk.index,
    });
    const artifact = await this.artifacts.getCached(request);
    if (!artifact) return undefined;
    return readSubtitleTranslationChunkArtifact(artifact.absolutePath, {
      sourceTrackRevision:
        group.request.source.artifact.artifact.artifactRevision,
      sourceLanguage: group.request.sourceLanguage,
      targetLanguage: group.request.targetLanguage,
      chunkIndex: chunk.index,
      chunkCount: group.chunks.length,
      startIndex: chunk.startIndex,
      endIndex: chunk.endIndex,
      targets: chunk.targets,
    });
  }

  private publishChunkProgress(
    group: TranslationGroup,
    completed: SubtitleTranslationChunkArtifactV1,
  ): void {
    let completedCues = [...group.completedChunks.values()].reduce(
      (count, chunk) => count + chunk.cues.length,
      0,
    );
    completedCues -= completed.cues.length;
    for (const cue of completed.cues) {
      completedCues += 1;
      this.progress.publish({
        assetId: group.request.assetId,
        sourceTrackRevision:
          group.request.source.artifact.artifact.artifactRevision,
        cue,
        completedCues,
        totalCues: group.request.source.track.cues.length,
      });
    }
  }

  private publishFailureIfIdle(group: TranslationGroup): void {
    if (
      group.cancelled ||
      group.failurePublished ||
      group.activeTasks.size > 0 ||
      group.failedTasks.size === 0
    ) {
      return;
    }
    const failure = [...group.failedTasks.values()].sort(
      (left, right) => left.createdTime - right.createdTime,
    )[0];
    if (!failure) return;
    group.failurePublished = true;
    this.publish({
      type: 'failed',
      assetId: group.request.assetId,
      sourceTrackRevision:
        group.request.source.artifact.artifact.artifactRevision,
      task: failure,
    });
  }

  private startFinalization(group: TranslationGroup): void {
    group.finalizing = this.finalize(group).finally(() => {
      group.finalizing = undefined;
    });
  }

  private async finalize(group: TranslationGroup): Promise<void> {
    try {
      const ordered = group.chunks.map((chunk) => {
        const completed = group.completedChunks.get(chunk.index);
        if (!completed) throw new AppError('DATA_INTEGRITY_ERROR');
        return completed;
      });
      const cues = ordered.flatMap((chunk) => chunk.cues);
      if (
        cues.length !== group.request.source.track.cues.length ||
        cues.some(
          (cue, index) =>
            cue.sourceCueId !== group.request.source.track.cues[index]?.id,
        )
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const firstEngine = ordered[0]?.engine;
      if (!firstEngine) throw new AppError('DATA_INTEGRITY_ERROR');
      const track: SubtitleTranslationTrackV1 = Object.freeze({
        version: 1,
        kind: 'subtitle-translation',
        sourceTrackRevision:
          group.request.source.artifact.artifact.artifactRevision,
        sourceLanguage: group.request.sourceLanguage,
        targetLanguage: group.request.targetLanguage,
        profile: 'quality',
        engine: firstEngine,
        generatedTime: this.now(),
        cues: Object.freeze(cues),
      });
      const artifact = await this.producer.materialize(
        this.artifacts,
        group.request.finalArtifactRequest,
        track,
      );
      if (group.cancelled) return;
      this.publish({
        type: 'completed',
        assetId: group.request.assetId,
        sourceTrackRevision:
          group.request.source.artifact.artifact.artifactRevision,
        artifact,
      });
      this.releaseGroup(group);
    } catch (error) {
      if (isAbortError(error) || group.cancelled) return;
      this.publish({
        type: 'failed',
        assetId: group.request.assetId,
        sourceTrackRevision:
          group.request.source.artifact.artifact.artifactRevision,
        error,
      });
    }
  }

  private releaseGroup(group: TranslationGroup): void {
    this.groups.delete(group.key);
    if (this.activeGroupByAsset.get(group.request.assetId) === group.key) {
      this.activeGroupByAsset.delete(group.request.assetId);
    }
    for (const taskId of group.activeTasks.values()) {
      this.taskOwners.delete(taskId);
    }
  }

  private publish(event: SubtitleTranslationAggregationEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
