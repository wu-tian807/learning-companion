import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import type { GenerationTaskSnapshot } from '../../main/generation/generation-task';
import type {
  CreateGenerationTaskRequest,
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
  GenerationTaskServiceListener,
} from '../../main/generation/generation-task-service';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
  type SubtitleCueV1,
  type SubtitleSourceTrackV1,
} from './contracts';
import {
  SUBTITLE_TRANSLATION_TASK_DEFINITION_ID,
  SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION,
  SubtitleTranslationInstruction,
} from './generation/subtitle-translation-instruction';
import {
  splitSubtitleTranslationChunks,
  type SubtitleTranslationChunk,
} from './generation/subtitle-translation-task-definition';
import {
  SubtitleTranslationTaskAggregator,
  type SubtitleTranslationAggregationRequest,
} from './subtitle-translation-aggregator';
import {
  SUBTITLE_TRANSLATION_CHUNK_ARTIFACT_MEDIA_TYPE,
  createSubtitleTranslationChunkArtifactRequest,
  type SubtitleTranslationChunkArtifactV1,
} from './translation-chunk-artifact';
import {
  createSubtitleTranslationArtifactKey,
  MediaSubtitleTranslationProducer,
  SubtitleTranslationProgressHub,
} from './translation-producer';

async function withDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'lc-translation-group-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function cue(index: number): SubtitleCueV1 {
  return Object.freeze({
    id: `cue-${String(index).padStart(3, '0')}`,
    startMs: index * 1_000,
    endMs: index * 1_000 + 900,
    text: `Sentence ${index}.`,
    sourceCueIds: Object.freeze([`raw-${index}`]),
  });
}

function createSource(
  directory: string,
  cueCount = 105,
): SubtitleTranslationAggregationRequest['source'] {
  const track: SubtitleSourceTrackV1 = Object.freeze({
    version: 1,
    kind: 'subtitle-source',
    sourceRevision: 'media-revision',
    language: 'en',
    origin: 'asr',
    engine: Object.freeze({
      id: 'whisper.cpp',
      version: '1',
      model: 'large-v3-turbo',
      backend: 'cuda',
    }),
    generatedTime: 100,
    cues: Object.freeze(
      Array.from({ length: cueCount }, (_, index) => cue(index + 1)),
    ),
  });
  return Object.freeze({
    track,
    workspacePath: directory,
    artifact: Object.freeze({
      absolutePath: join(directory, 'source.json'),
      cacheHit: true,
      artifact: Object.freeze({
        assetId: 'video',
        producerId: 'builtin.media-subtitles.transcription',
        artifactKey: 'source',
        relativePath: 'source.json',
        mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
        sourceRevision: 'media-revision',
        producerVersion: '1',
        artifactRevision: 'source-artifact-revision',
        updatedTime: 100,
      }),
    }),
  });
}

function artifactCacheKey(request: AssetArtifactRequest): string {
  return JSON.stringify([
    request.assetId,
    request.producerId,
    request.artifactKey,
    request.source.revision,
  ]);
}

function createTaskSnapshot(
  id: string,
  request: CreateGenerationTaskRequest,
): GenerationTaskSnapshot {
  return {
    id,
    projectId: request.projectId,
    definitionId: request.definitionId,
    definitionVersion: request.definitionVersion,
    instruction: request.instruction,
    assetReferences: request.assetReferences,
    agentCalls: [],
    metrics: {},
    createdTime: Number(id.replace(/\D/gu, '')) || 1,
    updatedTime: 1,
  } as unknown as GenerationTaskSnapshot;
}

function createGenerationTasks(initial: readonly GenerationTaskSnapshot[] = []) {
  const snapshots = new Map(initial.map((snapshot) => [snapshot.id, snapshot]));
  const listeners = new Set<GenerationTaskServiceListener>();
  let nextId = initial.length + 1;
  const start = vi.fn((request: CreateGenerationTaskRequest) => {
    const snapshot = createTaskSnapshot(`task-${nextId++}`, request);
    snapshots.set(snapshot.id, snapshot);
    return snapshot;
  });
  const retry = vi.fn((taskId: string) => {
    const existing = snapshots.get(taskId);
    if (!existing) throw new Error(`Missing task ${taskId}`);
    const snapshot = { ...existing, failure: undefined } as GenerationTaskSnapshot;
    snapshots.set(taskId, snapshot);
    return snapshot;
  });
  const cancel = vi.fn((taskId: string) => {
    const snapshot = snapshots.get(taskId);
    if (snapshot) {
      snapshots.set(taskId, {
        ...snapshot,
        cancelledTime: snapshot.updatedTime + 1,
      });
    }
  });
  const service = {
    subscribe: vi.fn((listener: GenerationTaskServiceListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    list: vi.fn(() => [...snapshots.values()].filter(({ completed }) => !completed)),
    get: vi.fn((taskId: string) => snapshots.get(taskId)),
    start,
    retry,
    cancel,
  } as unknown as GenerationTaskServiceApi;
  const publish = (event: GenerationTaskServiceEvent) => {
    if ('snapshot' in event) snapshots.set(event.snapshot.id, event.snapshot);
    for (const listener of listeners) listener(event);
  };
  return { service, start, retry, cancel, snapshots, publish };
}

function instructionChunkIndex(snapshot: GenerationTaskSnapshot): number {
  return Number(
    (snapshot.instruction as Record<string, unknown>).chunkIndex,
  );
}

function createAggregationRequest(
  source: SubtitleTranslationAggregationRequest['source'],
): SubtitleTranslationAggregationRequest {
  return Object.freeze({
    projectId: 'project',
    assetId: 'video',
    source,
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
    finalArtifactRequest: Object.freeze({
      assetId: 'video',
      producerId: 'builtin.media-subtitles.translation',
      artifactKey: createSubtitleTranslationArtifactKey('en', 'zh-Hans'),
      workspacePath: source.workspacePath,
      source: Object.freeze({
        assetId: 'video',
        mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
        absolutePath: source.artifact.absolutePath,
        revision: source.artifact.artifact.artifactRevision,
      }),
    }),
  });
}

describe('SubtitleTranslationTaskAggregator', () => {
  it('runs the first chunk alone, caps later tasks at three, and merges out-of-order completions in source order', async () => {
    await withDirectory(async (directory) => {
      const source = createSource(directory);
      await writeFile(source.artifact.absolutePath, JSON.stringify(source.track));
      const chunks = splitSubtitleTranslationChunks(source.track.cues);
      const cache = new Map<string, ResolvedAssetArtifact>();
      const producer = new MediaSubtitleTranslationProducer();
      const artifacts = {
        listAvailableByAsset: vi.fn(async () => []),
        getCached: vi.fn(async (request: AssetArtifactRequest) =>
          cache.get(artifactCacheKey(request)),
        ),
        getOrCreate: vi.fn(async (request: AssetArtifactRequest) => {
          const produced = await producer.produce(
            { ...request, stagingDirectory: directory },
            new AbortController().signal,
          );
          const resolved: ResolvedAssetArtifact = Object.freeze({
            absolutePath: produced.filePath,
            cacheHit: false,
            artifact: Object.freeze({
              assetId: request.assetId,
              producerId: request.producerId,
              artifactKey: request.artifactKey,
              relativePath: 'translation.json',
              mediaType: produced.mediaType,
              sourceRevision: request.source.revision,
              producerVersion: producer.version,
              artifactRevision: 'final-revision',
              updatedTime: 500,
            }),
          });
          cache.set(artifactCacheKey(request), resolved);
          return resolved;
        }),
      } as AssetArtifactServiceApi;
      const tasks = createGenerationTasks();
      const progress = new SubtitleTranslationProgressHub();
      const progressListener = vi.fn();
      progress.subscribe(progressListener);
      const aggregator = new SubtitleTranslationTaskAggregator(
        artifacts,
        tasks.service,
        producer,
        progress,
        { now: () => 400 },
      );
      const events: Parameters<Parameters<typeof aggregator.subscribe>[0]>[0][] = [];
      aggregator.subscribe((event) => events.push(event));
      const request = createAggregationRequest(source);

      const storeChunk = async (chunk: SubtitleTranslationChunk) => {
        const path = join(directory, `chunk-${chunk.index}.json`);
        const output: SubtitleTranslationChunkArtifactV1 = Object.freeze({
          version: 1,
          kind: 'subtitle-translation-chunk',
          sourceTrackRevision: source.artifact.artifact.artifactRevision,
          sourceLanguage: 'en',
          targetLanguage: 'zh-Hans',
          chunkIndex: chunk.index,
          chunkCount: chunks.length,
          startIndex: chunk.startIndex,
          endIndex: chunk.endIndex,
          engine: Object.freeze({
            id: 'codex',
            version: String(SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION),
            model: 'gpt-5.6-luna',
            backend: 'agent',
          }),
          generatedTime: 300 + chunk.index,
          cues: Object.freeze(
            chunk.targets.map(({ id }) =>
              Object.freeze({ sourceCueId: id, text: `译文 ${id}` }),
            ),
          ),
        });
        await writeFile(path, JSON.stringify(output));
        const chunkRequest = createSubtitleTranslationChunkArtifactRequest({
          assetId: 'video',
          workspacePath: directory,
          sourceArtifact: source.artifact,
          sourceLanguage: 'en',
          targetLanguage: 'zh-Hans',
          chunkIndex: chunk.index,
        });
        cache.set(
          artifactCacheKey(chunkRequest),
          Object.freeze({
            absolutePath: path,
            cacheHit: true,
            artifact: Object.freeze({
              assetId: 'video',
              producerId: chunkRequest.producerId,
              artifactKey: chunkRequest.artifactKey,
              relativePath: `chunk-${chunk.index}.json`,
              mediaType: SUBTITLE_TRANSLATION_CHUNK_ARTIFACT_MEDIA_TYPE,
              sourceRevision: chunkRequest.source.revision,
              producerVersion: '1',
              artifactRevision: `chunk-revision-${chunk.index}`,
              updatedTime: 300 + chunk.index,
            }),
          }),
        );
      };
      const completeChunk = async (chunkIndex: number) => {
        const entry = [...tasks.snapshots.values()].find(
          (snapshot) => instructionChunkIndex(snapshot) === chunkIndex,
        );
        if (!entry) throw new Error(`Missing chunk task ${chunkIndex}`);
        await storeChunk(chunks[chunkIndex]!);
        tasks.publish({
          type: 'task-completed',
          snapshot: {
            ...entry,
            completed: { completedTime: 500, result: {} },
          },
          result: { taskId: entry.id, result: {}, metrics: {} } as never,
        });
      };

      await aggregator.ensure(request);
      expect(tasks.start).toHaveBeenCalledOnce();
      expect(
        instructionChunkIndex(tasks.start.mock.results[0]!.value),
      ).toBe(0);

      await completeChunk(0);
      await vi.waitFor(() => expect(tasks.start).toHaveBeenCalledTimes(4));
      expect(
        tasks.start.mock.results
          .slice(1)
          .map(({ value }) => instructionChunkIndex(value)),
      ).toEqual([1, 2, 3]);

      await completeChunk(3);
      await vi.waitFor(() => expect(tasks.start).toHaveBeenCalledTimes(5));
      expect(instructionChunkIndex(tasks.start.mock.results[4]!.value)).toBe(4);
      await completeChunk(4);
      await completeChunk(2);
      await completeChunk(1);

      await vi.waitFor(() =>
        expect(events.some(({ type }) => type === 'completed')).toBe(true),
      );
      expect(progressListener).toHaveBeenCalledTimes(105);
      const final = events.find(({ type }) => type === 'completed');
      expect(final).toMatchObject({
        type: 'completed',
        artifact: { artifact: { mediaType: SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE } },
      });
      const written = JSON.parse(
        await readFile(join(directory, 'translation.json'), 'utf8'),
      ) as { cues: Array<{ sourceCueId: string; text: string }> };
      expect(written.cues).toHaveLength(105);
      expect(written.cues[0]).toEqual({
        sourceCueId: 'cue-001',
        text: '译文 cue-001',
      });
      expect(written.cues[104]).toEqual({
        sourceCueId: 'cue-105',
        text: '译文 cue-105',
      });
    });
  });

  it('recovers cached chunks and retries only the failed chunk task', async () => {
    await withDirectory(async (directory) => {
      const source = createSource(directory, 70);
      await writeFile(source.artifact.absolutePath, JSON.stringify(source.track));
      const chunks = splitSubtitleTranslationChunks(source.track.cues);
      const chunkZeroInstruction = new SubtitleTranslationInstruction({
        assetId: 'video',
        sourceTrackRevision: source.artifact.artifact.artifactRevision,
        sourceLanguage: 'en',
        targetLanguage: 'zh-Hans',
        chunkIndex: 1,
      }).toSnapshot();
      const failed = {
        ...createTaskSnapshot('task-7', {
          projectId: 'project',
          definitionId: SUBTITLE_TRANSLATION_TASK_DEFINITION_ID,
          definitionVersion: SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION,
          instruction: chunkZeroInstruction,
          assetReferences: {},
        }),
        failure: {
          phase: 'process',
          failedTime: 200,
          code: 'CODEX_REQUEST_FAILED',
          message: 'AI 请求没有完成。',
        },
      } as GenerationTaskSnapshot;
      const tasks = createGenerationTasks([failed]);
      const producer = new MediaSubtitleTranslationProducer();
      const firstPath = join(directory, 'chunk-0.json');
      const first = chunks[0]!;
      const firstOutput: SubtitleTranslationChunkArtifactV1 = {
        version: 1,
        kind: 'subtitle-translation-chunk',
        sourceTrackRevision: source.artifact.artifact.artifactRevision,
        sourceLanguage: 'en',
        targetLanguage: 'zh-Hans',
        chunkIndex: 0,
        chunkCount: chunks.length,
        startIndex: first.startIndex,
        endIndex: first.endIndex,
        engine: {
          id: 'codex',
          version: String(SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION),
          model: 'gpt-5.6-luna',
          backend: 'agent',
        },
        generatedTime: 300,
        cues: first.targets.map(({ id }) => ({
          sourceCueId: id,
          text: `译文 ${id}`,
        })),
      };
      await writeFile(firstPath, JSON.stringify(firstOutput));
      const firstRequest = createSubtitleTranslationChunkArtifactRequest({
        assetId: 'video',
        workspacePath: directory,
        sourceArtifact: source.artifact,
        sourceLanguage: 'en',
        targetLanguage: 'zh-Hans',
        chunkIndex: 0,
      });
      const firstResolved: ResolvedAssetArtifact = {
        absolutePath: firstPath,
        cacheHit: true,
        artifact: {
          assetId: 'video',
          producerId: firstRequest.producerId,
          artifactKey: firstRequest.artifactKey,
          relativePath: 'chunk-0.json',
          mediaType: SUBTITLE_TRANSLATION_CHUNK_ARTIFACT_MEDIA_TYPE,
          sourceRevision: firstRequest.source.revision,
          producerVersion: '1',
          artifactRevision: 'chunk-0-revision',
          updatedTime: 300,
        },
      };
      const artifacts = {
        listAvailableByAsset: vi.fn(async () => []),
        getCached: vi.fn(async (request: AssetArtifactRequest) =>
          request.artifactKey === firstRequest.artifactKey
            ? firstResolved
            : undefined,
        ),
        getOrCreate: vi.fn(),
      } as unknown as AssetArtifactServiceApi;
      const progress = new SubtitleTranslationProgressHub();
      const progressListener = vi.fn();
      progress.subscribe(progressListener);
      const aggregator = new SubtitleTranslationTaskAggregator(
        artifacts,
        tasks.service,
        producer,
        progress,
      );

      await aggregator.ensure(createAggregationRequest(source));

      expect(progressListener).toHaveBeenCalledTimes(first.targets.length);
      expect(tasks.retry).toHaveBeenCalledExactlyOnceWith('task-7');
      expect(
        tasks.start.mock.results.map(({ value }) =>
          instructionChunkIndex(value),
        ),
      ).toEqual([2]);
      expect(
        [...tasks.snapshots.values()]
          .filter((snapshot) => !snapshot.completed)
          .map(instructionChunkIndex)
          .sort((left, right) => left - right),
      ).toEqual([1, 2]);

      aggregator.cancel('video');
      expect(tasks.cancel).toHaveBeenCalledTimes(2);
      expect(tasks.cancel).toHaveBeenCalledWith('task-7');
    });
  });
});
