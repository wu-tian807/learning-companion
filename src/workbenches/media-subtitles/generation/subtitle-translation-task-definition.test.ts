import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
} from '../../../main/artifacts/asset-artifact-service';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import type {
  GenerationTaskProcessContext,
  TaskAgentCallRequest,
  TaskAgentCallResult,
} from '../../../main/generation/contracts/task-definition';
import type { ProjectLookup } from '../../../main/projects/project-database';
import type { AssetSnapshot } from '../../../shared/assets';
import { LOW_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID } from '../../../shared/agent-provider-selectors';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  type SubtitleCueV1,
  type SubtitleSourceTrackV1,
} from '../contracts';
import { MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID } from '../transcription-producer';
import {
  MediaSubtitleTranslationChunkProducer,
} from '../translation-chunk-artifact';
import {
  SubtitleTranslationInstruction,
  subtitleTranslationInstructionFactory,
} from './subtitle-translation-instruction';
import {
  createSubtitleTranslationChunkPrompt,
  createSubtitleTranslationTaskDefinition,
  splitSubtitleTranslationChunks,
} from './subtitle-translation-task-definition';

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'lc-llm-subtitles-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function cue(index: number): SubtitleCueV1 {
  return {
    id: `cue-${index}`,
    startMs: index * 1_000,
    endMs: index * 1_000 + 900,
    text: `Sentence ${index}.`,
    sourceCueIds: [`raw-${index}`],
  };
}

function callResult(
  request: Pick<TaskAgentCallRequest, 'callKey' | 'purpose'>,
  output: string,
): TaskAgentCallResult {
  return {
    callKey: request.callKey,
    purpose: request.purpose,
    sessionId: 'session',
    assistantOutput: output,
    metrics: {
      callKey: request.callKey,
      purpose: request.purpose,
      sessionId: 'session',
      providerId: 'codex',
      connectionId: 'connection',
      modelId: 'gpt-5.6-luna',
      startedTime: 100,
      completedTime: 101,
      activeDurationMs: 1,
      turnCount: 1,
      repairTurnCount: 0,
    },
  };
}

describe('subtitle translation TaskDefinition', () => {
  it('splits only on real Cue boundaries and supplies adjacent context', () => {
    const cues = Array.from({ length: 18 }, (_, index) => cue(index + 1));
    const chunks = splitSubtitleTranslationChunks(cues);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.targets).toHaveLength(8);
    expect(chunks[1]?.targets.map(({ id }) => id)).toEqual([
      'cue-9',
      'cue-10',
      'cue-11',
      'cue-12',
      'cue-13',
      'cue-14',
      'cue-15',
      'cue-16',
      'cue-17',
      'cue-18',
    ]);
    expect(chunks[1]?.previous.map(({ id }) => id)).toEqual([
      'cue-6',
      'cue-7',
      'cue-8',
    ]);
    expect(chunks[0]?.next.map(({ id }) => id)).toEqual([
      'cue-9',
      'cue-10',
      'cue-11',
    ]);
  });

  it('keeps an oversized Cue intact instead of inventing a text or timing split', () => {
    const oversized = {
      ...cue(1),
      text: 'A'.repeat(1_401),
    };
    const chunks = splitSubtitleTranslationChunks([oversized, cue(2)]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.targets).toEqual([oversized]);
    expect(chunks[1]?.targets).toEqual([cue(2)]);
  });

  it('marks adjacent Cues as context only and rejects same-language tasks', () => {
    const [chunk] = splitSubtitleTranslationChunks([cue(1), cue(2), cue(3)]);
    const prompt = createSubtitleTranslationChunkPrompt(chunk!, 'en', 'zh-Hans');

    expect(prompt).toContain('previous 和 next 只用于理解');
    expect(prompt).toContain('禁止翻译或输出它们');
    expect(
      subtitleTranslationInstructionFactory.parse({
        format: 'media-subtitle-translation',
        version: 2,
        assetId: 'video',
        sourceTrackRevision: 'revision',
        sourceLanguage: 'en',
        targetLanguage: 'en',
        chunkIndex: 0,
      }),
    ).toMatchObject({ ok: false });
  });

  it('translates exactly one chunk and keeps its repair turn in the same task session', async () => {
    await withDirectory(async (directory) => {
      const videoPath = join(directory, 'video.mp4');
      const sourcePath = join(directory, 'source.json');
      await writeFile(videoPath, 'video');
      const cues = Array.from({ length: 105 }, (_, index) => cue(index + 1));
      const chunks = splitSubtitleTranslationChunks(cues);
      const sourceTrack: SubtitleSourceTrackV1 = {
        version: 1,
        kind: 'subtitle-source',
        sourceRevision: 'video-revision',
        language: 'en',
        origin: 'asr',
        engine: { id: 'asr', version: '1', model: 'model', backend: 'gpu' },
        generatedTime: 100,
        cues,
      };
      await writeFile(sourcePath, JSON.stringify(sourceTrack));
      const asset: AssetSnapshot = {
        id: 'video',
        projectId: 'project',
        name: 'Video',
        mediaType: 'video/mp4',
        creationKind: 'imported',
        contentRef: { kind: 'local-file', base: 'absolute', path: videoPath },
        contentStatus: { availability: 'available', checkedTime: 100 },
        createdTime: 100,
        updatedTime: 100,
      };
      const assets = {
        get: vi.fn(() => asset),
        resolveContent: vi.fn(async () => ({
          contentRef: asset.contentRef,
          contentStatus: asset.contentStatus,
          location: { kind: 'local-file' as const, absolutePath: videoPath },
          handle: { close: vi.fn(async () => undefined) },
        })),
      } as unknown as AssetServiceApi;
      const projects: ProjectLookup = {
        get: vi.fn(() => ({
          id: 'project',
          name: 'Project',
          icon: 'P',
          pinned: false,
          workspacePath: directory,
          createdTime: 100,
        })),
      };
      const producer = new MediaSubtitleTranslationChunkProducer();
      const getCached = vi.fn(async (request: AssetArtifactRequest) =>
        request.producerId === MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID
          ? {
              absolutePath: sourcePath,
              cacheHit: true,
              artifact: {
                assetId: 'video',
                producerId: request.producerId,
                artifactKey: request.artifactKey,
                relativePath: 'source.json',
                mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
                sourceRevision: 'video-revision',
                producerVersion: '3',
                artifactRevision: 'source-artifact-revision',
                updatedTime: 100,
              },
            }
          : undefined,
      );
      const getOrCreate = vi.fn(async (request: AssetArtifactRequest) => {
        const produced = await producer.produce(
          { ...request, stagingDirectory: directory },
          new AbortController().signal,
        );
        return {
          absolutePath: produced.filePath,
          cacheHit: false,
          artifact: {
            assetId: 'video',
            producerId: producer.id,
            artifactKey: request.artifactKey,
            relativePath: 'translation-chunk.json',
            mediaType: produced.mediaType,
            sourceRevision: request.source.revision,
            producerVersion: producer.version,
            artifactRevision: 'translation-chunk-revision',
            updatedTime: 200,
          },
        };
      });
      const artifacts = {
        listAvailableByAsset: vi.fn(async () => []),
        getCached,
        getOrCreate,
      } as AssetArtifactServiceApi;
      const completedCalls: TaskAgentCallResult[] = [];
      const call = vi.fn(async (request: TaskAgentCallRequest) => {
        const chunk = chunks[0]!;
        let output: string;
        if (request.callKey === 'translate-0001') {
          output = 'not json';
        } else {
          output = JSON.stringify({
            translations: chunk.targets.map(({ id }) => ({
              id,
              text: `译文 ${id}`,
            })),
          });
        }
        const result = callResult(request, output);
        completedCalls.push(result);
        return result;
      });
      const instruction = new SubtitleTranslationInstruction({
        assetId: 'video',
        sourceTrackRevision: 'source-artifact-revision',
        sourceLanguage: 'en',
        targetLanguage: 'zh-Hans',
        chunkIndex: 0,
      });
      const context = {
        taskId: 'task',
        projectId: 'project',
        instruction,
        workspaces: { primary: {}, secondary: [] },
        assetReferences: {},
        preparedUserMessage: instruction.toUserMessage(),
        agent: { completedCalls, call },
        reportStatus: vi.fn(),
        reportOutputRejected: vi.fn(),
      } as unknown as GenerationTaskProcessContext<SubtitleTranslationInstruction>;
      const definition = createSubtitleTranslationTaskDefinition({
        assets,
        artifacts,
        projects,
        producer,
        now: () => 300,
      });
      expect(definition.providerSelectorId).toBe(
        LOW_INTELLIGENCE_AGENT_PROVIDER_SELECTOR_ID,
      );

      const result = await definition.process(context);
      expect(call.mock.calls.slice(0, 2).map(([request]) => request.callKey))
        .toEqual([
        'translate-0001',
        'translate-0001-repair',
      ]);
      expect(
        call.mock.calls.map(([request]) => request.callKey).sort(),
      ).toEqual([
        'translate-0001',
        'translate-0001-repair',
      ]);
      expect(context.reportOutputRejected).toHaveBeenCalledOnce();
      expect(getOrCreate).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        chunkIndex: 0,
        artifactRevision: 'translation-chunk-revision',
      });
      const written = JSON.parse(
        await readFile(join(directory, 'translation-chunk.json'), 'utf8'),
      );
      expect(written).toMatchObject({
        kind: 'subtitle-translation-chunk',
        chunkIndex: 0,
        chunkCount: chunks.length,
      });
      expect(written.cues).toHaveLength(8);
      expect(written.cues[7]).toEqual({
        sourceCueId: 'cue-8',
        text: '译文 cue-8',
      });
      expect(written).toMatchObject({
        engine: { model: 'gpt-5.6-luna', backend: 'agent' },
      });
    });
  });
});
