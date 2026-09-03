import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import type { ExternalCommandRunnerApi } from '../../main/external-libraries/external-command-runner';
import type {
  SubtitleSourceTrackV1,
  SubtitleTranslationTrackV1,
} from '../media-subtitles/contracts';
import type {
  MediaSubtitleRuntime,
  MediaSubtitleRuntimeResolverApi,
} from '../media-subtitles/external-libraries/media-subtitle-runtime';
import type {
  VoxCpm2DubbingRuntime,
  VoxCpm2DubbingRuntimeResolverApi,
} from './external-libraries/voxcpm2-runtime';
import {
  VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE,
  VOXCPM2_DUBBING_PRODUCER_ID,
  MediaDubbingProgressHub,
  VoxCpm2DubbingProducer,
  createVoxCpm2DubbingArtifactKey,
  type MediaDubbingProgress,
} from './voxcpm2-dubbing-producer';

const temporaryDirectories: string[] = [];

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lc-voxcpm2-producer-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function sourceTrack(
  sourceRevision: string,
  includeSpeakers = true,
): SubtitleSourceTrackV1 {
  return {
    version: 1,
    kind: 'subtitle-source',
    sourceRevision,
    language: 'en',
    origin: 'asr',
    engine: {
      id: 'whisper.cpp',
      version: '1',
      model: 'turbo',
      backend: 'cuda',
    },
    ...(includeSpeakers
      ? {
          speakerAnalysis: {
            method: 'post-hoc-diarization' as const,
            supportsOverlappingTranscription: false,
            segments: [
              { speakerId: 'speaker-0001', startMs: 0, endMs: 6_500 },
              { speakerId: 'speaker-0002', startMs: 8_000, endMs: 8_700 },
            ],
          },
        }
      : {}),
    generatedTime: 100,
    cues: [
      {
        id: 'unsafe:/cue-1',
        startMs: 0,
        endMs: 3_500,
        text: 'This is a sufficiently long reference sentence.',
        sourceCueIds: ['raw-1'],
        ...(includeSpeakers ? { speakerId: 'speaker-0001' } : {}),
      },
      {
        id: 'cue-2',
        startMs: 3_700,
        endMs: 6_500,
        text: 'This sentence completes the reference window.',
        sourceCueIds: ['raw-2'],
        ...(includeSpeakers ? { speakerId: 'speaker-0001' } : {}),
      },
      {
        id: 'cue-3',
        startMs: 8_000,
        endMs: 11_000,
        text: 'This phrase should be generated first.',
        sourceCueIds: ['raw-3'],
        ...(includeSpeakers ? { speakerId: 'speaker-0002' } : {}),
      },
    ],
  };
}

function translationTrack(): SubtitleTranslationTrackV1 {
  return {
    version: 1,
    kind: 'subtitle-translation',
    sourceTrackRevision: 'source-artifact-revision',
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
    profile: 'quality',
    engine: { id: 'codex', version: '1', model: 'gpt', backend: 'agent' },
    generatedTime: 200,
    cues: [
      { sourceCueId: 'unsafe:/cue-1', text: '这是第一段参考内容。' },
      { sourceCueId: 'cue-2', text: '这是第二段参考内容。' },
      { sourceCueId: 'cue-3', text: '这一段应该最先生成。' },
    ],
  };
}

function request(directory: string): AssetArtifactRequest {
  return {
    assetId: 'video',
    producerId: VOXCPM2_DUBBING_PRODUCER_ID,
    artifactKey: createVoxCpm2DubbingArtifactKey('zh-Hans'),
    workspacePath: directory,
    source: {
      assetId: 'video',
      mediaType: 'video/mp4',
      absolutePath: resolve(directory, 'video.mp4'),
      revision: 'dubbing-input-revision',
    },
  };
}

function createSubtitleRuntime(
  directory: string,
): MediaSubtitleRuntimeResolverApi {
  const runtime: MediaSubtitleRuntime = {
    decoder: {
      ffmpegPath: resolve(directory, 'ffmpeg.exe'),
      ffprobePath: resolve(directory, 'ffprobe.exe'),
    },
    transcription: {
      kind: 'sensevoice',
      executablePath: resolve(directory, 'sensevoice.exe'),
      vadExecutablePath: resolve(directory, 'vad.exe'),
      modelPath: resolve(directory, 'sensevoice.gguf'),
      vadModelPath: resolve(directory, 'vad.gguf'),
    },
    speakerDiarization: {
      executablePath: resolve(directory, 'diarization.exe'),
      segmentationModelPath: resolve(directory, 'segmentation.onnx'),
      embeddingModelPath: resolve(directory, 'embedding.onnx'),
    },
  };
  return {
    requireMediaDecoder: vi.fn(async () => runtime.decoder),
    requireTranscription: vi.fn(async () => runtime.transcription),
    async withRuntime(signal, operation) {
      return operation(runtime, signal ?? new AbortController().signal);
    },
  };
}

function createDubbingRuntime(
  directory: string,
  runVoiceJob: VoxCpm2DubbingRuntimeResolverApi['runVoiceJob'],
): VoxCpm2DubbingRuntimeResolverApi {
  const runtime: VoxCpm2DubbingRuntime = {
    pythonPath: resolve(directory, 'python.exe'),
    modelPath: resolve(directory, 'VoxCPM2'),
    separationModelPath: resolve(directory, 'UVR.onnx'),
    workerCachePath: resolve(directory, 'worker-cache'),
    environment: {},
  };
  return {
    requireInstalledBundle: vi.fn(async () => undefined),
    requireRuntime: vi.fn(async () => runtime),
    async withRuntime(signal, operation) {
      return operation(runtime, signal);
    },
    warmup: vi.fn(async () => undefined),
    releaseWarmup: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    runVoiceJob,
  };
}

describe('VoxCpm2DubbingProducer', () => {
  it('analyzes video speakers on demand before cloning and mixing', async () => {
    const directory = await createDirectory();
    const stagingDirectory = join(directory, 'staging');
    await mkdir(stagingDirectory, { recursive: true });
    await writeFile(join(directory, 'video.mp4'), 'video');
    const progressHub = new MediaDubbingProgressHub();
    const progress: MediaDubbingProgress[] = [];
    progressHub.subscribe((event) => progress.push(event));
    let releaseFullPreparation!: () => void;
    const fullPreparationGate = new Promise<void>((resolvePromise) => {
      releaseFullPreparation = resolvePromise;
    });
    let resolveSeparationStarted!: () => void;
    const separationStarted = new Promise<void>((resolvePromise) => {
      resolveSeparationStarted = resolvePromise;
    });
    let diarizationStarted = false;
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async (command) => {
      if (command.command.endsWith('ffprobe.exe')) {
        return { stdout: '12.000\n', stderr: '' };
      }
      if (command.command.endsWith('ffmpeg.exe')) {
        await writeFile(command.args.at(-1)!, 'audio');
      }
      if (command.args.some((argument) => argument.endsWith('separate.py'))) {
        resolveSeparationStarted();
        await fullPreparationGate;
        const outputPath = command.args[command.args.indexOf('--output') + 1]!;
        await mkdir(outputPath, { recursive: true });
        await Promise.all([
          writeFile(join(outputPath, 'background.wav'), 'background'),
          writeFile(join(outputPath, 'vocals.wav'), 'vocals'),
        ]);
      }
      if (command.command.endsWith('diarization.exe')) {
        diarizationStarted = true;
        await fullPreparationGate;
        return {
          stdout: '0.000 -- 6.500 speaker_7\n8.000 -- 8.700 speaker_2\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });
    const producer = new VoxCpm2DubbingProducer(progressHub, {
      commandRunner: { run },
    });
    const artifactRequest = request(directory);
    const artifacts = {
      listAvailableByAsset: vi.fn(async () => []),
      getCached: vi.fn(),
      getOrCreate: vi.fn(async (_request, signal) => {
        const produced = await producer.produce(
          {
            source: artifactRequest.source,
            artifactKey: artifactRequest.artifactKey,
            workspacePath: artifactRequest.workspacePath,
            stagingDirectory,
          },
          signal ?? new AbortController().signal,
        );
        return {
          absolutePath: produced.filePath,
          cacheHit: false,
          artifact: {
            assetId: 'video',
            producerId: producer.id,
            artifactKey: artifactRequest.artifactKey,
            relativePath: 'artifacts/dubbed.m4a',
            mediaType: produced.mediaType,
            sourceRevision: artifactRequest.source.revision,
            producerVersion: producer.version,
            artifactRevision: 'dubbing-artifact-revision',
            updatedTime: 300,
          },
        } satisfies ResolvedAssetArtifact;
      }),
    } as AssetArtifactServiceApi;
    const subtitleRuntime = createSubtitleRuntime(directory);
    const dubbingRuntime = createDubbingRuntime(
      directory,
      vi.fn(async (job) => {
        if (job.bootstrapJob) {
          await mkdir(job.bootstrapJob.outputDirectory, { recursive: true });
          await Promise.all([
            writeFile(job.bootstrapJob.previewPath, 'quick-preview'),
            writeFile(
              job.bootstrapJob.progressPath,
              JSON.stringify({
                completedPhrases: 1,
                totalPhrases: 1,
                completedDurationMs: 4_000,
                readySuffixStartMs: 8_000,
                previewReady: true,
              }),
            ),
          ]);
          await vi.waitFor(async () => {
            await expect(access(job.inputsReadyPath!)).resolves.toBeUndefined();
          });
        }
        await mkdir(job.outputDirectory, { recursive: true });
        await Promise.all([
          writeFile(join(job.outputDirectory, 'voice.wav'), 'voice'),
          writeFile(job.previewPath, 'preview'),
          writeFile(
            job.progressPath,
            JSON.stringify({
              completedPhrases: 3,
              totalPhrases: 3,
              completedDurationMs: 12_000,
              readySuffixStartMs: 0,
              previewReady: true,
            }),
          ),
        ]);
      }),
    );

    const materializing = producer.materialize(
      artifacts,
      artifactRequest,
      sourceTrack('video-revision', false),
      translationTrack(),
      subtitleRuntime,
      dubbingRuntime,
    );
    await separationStarted;
    const diarizationWasStartedBeforeFullPreparation = diarizationStarted;
    const bootstrapPreviewWasPublishedBeforeFullPreparation = progress.some(
      (event) =>
        event.phase === 'cloning' &&
        event.completedPhrases === 1 &&
        event.previewAudioPath?.includes('first-phrase-preview'),
    );
    releaseFullPreparation();
    const artifact = await materializing;

    expect(diarizationWasStartedBeforeFullPreparation).toBe(true);
    expect(bootstrapPreviewWasPublishedBeforeFullPreparation).toBe(true);
    expect(artifact.artifact.mediaType).toBe(
      VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE,
    );
    const phrases = JSON.parse(
      await readFile(join(stagingDirectory, 'phrases.json'), 'utf8'),
    ) as {
      readonly phrases: readonly {
        readonly id: string;
        readonly speakerId: string;
      }[];
    };
    expect(phrases.phrases.map(({ id }) => id)).toEqual([
      'phrase-000001',
      'phrase-000002',
      'phrase-000003',
    ]);
    expect(phrases.phrases.map(({ speakerId }) => speakerId)).toEqual([
      'speaker-0001',
      'speaker-0001',
      'speaker-0002',
    ]);
    expect(
      run.mock.calls.some(([call]) =>
        call.args.some((argument) => argument.endsWith('separate.py')),
      ),
    ).toBe(true);
    expect(
      run.mock.calls.some(([call]) => call.command.endsWith('diarization.exe')),
    ).toBe(true);
    expect(
      run.mock.calls.find(
        ([call]) =>
          call.command.endsWith('ffmpeg.exe') &&
          call.args.at(-1)?.endsWith('original.wav'),
      )?.[0].args,
    ).toEqual(
      expect.arrayContaining(['-af', 'apad=pad_dur=12.000', '-t', '12.000']),
    );
    expect(dubbingRuntime.runVoiceJob).toHaveBeenCalledOnce();
    const voiceJob = vi.mocked(dubbingRuntime.runVoiceJob).mock.calls[0]![0];
    expect(voiceJob).toMatchObject({
      referencePaths: {},
      waitForInputs: true,
      bootstrapJob: expect.objectContaining({
        backgroundGain: 0.12,
        referencePaths: {
          'speaker-0001': expect.stringContaining('reference.wav'),
        },
      }),
    });
    await expect(
      readFile(voiceJob.referencePathsPath!, 'utf8').then(JSON.parse),
    ).resolves.toEqual({
      'speaker-0001': join(
        directory,
        '.learning-companion',
        'checkpoints',
        'video-dubbing',
        'video',
        'dubbing-input-revision',
        'references',
        'speaker-0001.wav',
      ),
      'speaker-0002': null,
    });
    expect(
      run.mock.calls.some(([call]) =>
        call.args.some((argument) => argument.endsWith('preview.wav')),
      ),
    ).toBe(true);
    expect(progress.map(({ phase }) => phase)).toEqual(
      expect.arrayContaining([
        'preparing-runtime',
        'separating',
        'cloning',
        'mixing',
      ]),
    );
    expect(
      progress.find(({ speakerTrack }) => speakerTrack !== undefined)
        ?.speakerTrack,
    ).toMatchObject({
      sourceTrackRevision: 'source-artifact-revision',
      cues: [
        {
          sourceCueId: 'unsafe:/cue-1',
          speakerId: 'speaker-0001',
          status: 'stable',
        },
        expect.objectContaining({ sourceCueId: 'cue-2' }),
        expect.objectContaining({
          sourceCueId: 'cue-3',
          speakerId: 'speaker-0002',
        }),
      ],
    });
    expect(progress).toContainEqual(
      expect.objectContaining({
        phase: 'cloning',
        completedPhrases: 1,
        previewAudioPath: expect.stringContaining('first-phrase-preview'),
      }),
    );
    expect(progress).toContainEqual(expect.objectContaining({
      phase: 'cloning',
      completedPhrases: 3,
      previewAudioPath: join(
        directory,
        '.learning-companion',
        'checkpoints',
        'video-dubbing',
        'video',
        'dubbing-input-revision',
        'preview.wav',
      ),
    }));

    const checkpointDirectory = join(
      directory,
      '.learning-companion',
      'checkpoints',
      'video-dubbing',
      'video',
      'dubbing-input-revision',
    );
    await writeFile(
      join(checkpointDirectory, 'progress.json'),
      JSON.stringify({
        completedPhrases: 2,
        totalPhrases: 3,
        completedDurationMs: 8_300,
        readySuffixStartMs: 3_700,
        previewReady: true,
      }),
    );
    await expect(
      producer.getInterruptedProgress(
        artifactRequest,
        sourceTrack('video-revision', false),
        translationTrack(),
      ),
    ).resolves.toMatchObject({
      completedPhrases: 2,
      totalPhrases: 3,
      completedDurationMs: 8_300,
      durationMs: 12_000,
      readySuffixStartMs: 3_700,
      previewAudioPath: join(checkpointDirectory, 'preview.wav'),
      speakerTrack: expect.objectContaining({
        sourceTrackRevision: 'source-artifact-revision',
      }),
    });
    await expect(
      producer.getPreparedSpeakerTrack(
        artifactRequest,
        sourceTrack('video-revision', false),
        translationTrack(),
      ),
    ).resolves.toMatchObject({
      sourceTrackRevision: 'source-artifact-revision',
    });
    run.mockClear();
    progress.splice(0);

    await producer.materialize(
      artifacts,
      artifactRequest,
      sourceTrack('video-revision', false),
      translationTrack(),
      subtitleRuntime,
      dubbingRuntime,
    );

    expect(
      run.mock.calls.some(([call]) => call.command.endsWith('ffprobe.exe')),
    ).toBe(false);
    expect(
      run.mock.calls.some(([call]) =>
        call.args.some((argument) => argument.endsWith('separate.py')),
      ),
    ).toBe(false);
    expect(
      run.mock.calls.some(([call]) => call.command.endsWith('diarization.exe')),
    ).toBe(false);
    expect(progress).toContainEqual(
      expect.objectContaining({
        phase: 'cloning',
        completedPhrases: 2,
        readySuffixStartMs: 3_700,
      }),
    );
  });

  it('rejects an artifact key that does not match the translation language', async () => {
    const directory = await createDirectory();
    const producer = new VoxCpm2DubbingProducer(new MediaDubbingProgressHub());

    await expect(
      producer.materialize(
        {
          listAvailableByAsset: vi.fn(async () => []),
          getCached: vi.fn(),
          getOrCreate: vi.fn(),
        },
        {
          ...request(directory),
          artifactKey: createVoxCpm2DubbingArtifactKey('en'),
        },
        sourceTrack('video-revision'),
        translationTrack(),
        {} as MediaSubtitleRuntimeResolverApi,
        {} as VoxCpm2DubbingRuntimeResolverApi,
      ),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
  });

  it('propagates cancellation during parallel preparation and aborts preview synthesis', async () => {
    const directory = await createDirectory();
    const stagingDirectory = join(directory, 'staging');
    await mkdir(stagingDirectory, { recursive: true });
    await writeFile(join(directory, 'video.mp4'), 'video');
    const controller = new AbortController();
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async (command) => {
      if (command.command.endsWith('ffprobe.exe')) {
        return { stdout: '12.000\n', stderr: '' };
      }
      if (command.command.endsWith('ffmpeg.exe')) {
        await writeFile(command.args.at(-1)!, 'audio');
      }
      if (command.args.some((argument) => argument.endsWith('separate.py'))) {
        expect(command.signal).toBeInstanceOf(AbortSignal);
        expect(command.timeoutMs).toBe(4 * 60 * 60 * 1_000);
        controller.abort();
        throw new DOMException('cancelled', 'AbortError');
      }
      return { stdout: '', stderr: '' };
    });
    const producer = new VoxCpm2DubbingProducer(new MediaDubbingProgressHub(), {
      commandRunner: { run },
    });
    const artifactRequest = request(directory);
    const artifacts = {
      listAvailableByAsset: vi.fn(async () => []),
      getCached: vi.fn(),
      getOrCreate: vi.fn(async (_request, signal) => {
        await producer.produce(
          {
            source: artifactRequest.source,
            artifactKey: artifactRequest.artifactKey,
            workspacePath: artifactRequest.workspacePath,
            stagingDirectory,
          },
          signal ?? new AbortController().signal,
        );
        throw new Error('unreachable');
      }),
    } as unknown as AssetArtifactServiceApi;
    const subtitleRuntime = createSubtitleRuntime(directory);
    const runVoiceJob = vi.fn(async (job, signal) => {
      signal.throwIfAborted();
      if (!job.bootstrapJob) throw new Error('missing bootstrap job');
      await mkdir(job.bootstrapJob.outputDirectory, { recursive: true });
      await Promise.all([
        writeFile(job.bootstrapJob.previewPath, 'quick-preview'),
        writeFile(
          job.bootstrapJob.progressPath,
          JSON.stringify({
            completedPhrases: 1,
            totalPhrases: 1,
            completedDurationMs: 4_000,
            readySuffixStartMs: 8_000,
            previewReady: true,
          }),
        ),
      ]);
      await new Promise<never>((_resolvePromise, rejectPromise) => {
        const rejectAborted = () => rejectPromise(signal.reason);
        signal.addEventListener('abort', rejectAborted, { once: true });
      });
    });
    const dubbingRuntime = createDubbingRuntime(directory, runVoiceJob);

    await expect(
      producer.materialize(
        artifacts,
        artifactRequest,
        sourceTrack('video-revision'),
        translationTrack(),
        subtitleRuntime,
        dubbingRuntime,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(runVoiceJob).toHaveBeenCalledOnce();
    await expect(
      access(
        join(
          directory,
          '.learning-companion',
          'checkpoints',
          'video-dubbing',
          'video',
          'dubbing-input-revision',
          'checkpoint.json',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
