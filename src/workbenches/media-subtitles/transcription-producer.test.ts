import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ExternalCommandRunnerApi } from '../../main/external-libraries/external-command-runner';
import { isSubtitleSourceTrackV1 } from './contracts';
import type {
  MediaSubtitleRuntimeResolverApi,
  SubtitleTranscriptionRuntime,
} from './external-libraries/media-subtitle-runtime';
import {
  MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
  MediaSubtitleTranscriptionProducer,
} from './transcription-producer';

async function withDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'lc-subtitle-transcription-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runtimeResolver(
  transcription: SubtitleTranscriptionRuntime,
  directory: string,
): MediaSubtitleRuntimeResolverApi {
  const decoder = {
    ffmpegPath: join(directory, 'ffmpeg.exe'),
    ffprobePath: join(directory, 'ffprobe.exe'),
  };
  return {
    requireMediaDecoder: vi.fn(async () => decoder),
    requireTranscription: vi.fn(async () => transcription),
    async withRuntime(signal, operation) {
      return operation(
        { decoder, transcription },
        signal ?? new AbortController().signal,
      );
    },
  };
}

function request(directory: string) {
  return {
    artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
    workspacePath: directory,
    stagingDirectory: directory,
    source: {
      assetId: 'media',
      mediaType: 'video/mp4',
      absolutePath: join(directory, 'video.mp4'),
      revision: 'video-revision',
    },
  } as const;
}

describe('MediaSubtitleTranscriptionProducer', () => {
  it('uses MOSS Q5 to jointly produce overlapping subtitles and speakers', async () => {
    await withDirectory(async (directory) => {
      const run = vi.fn<ExternalCommandRunnerApi['run']>(async (command) => {
        const outputIndex = command.args.indexOf('--output');
        if (outputIndex >= 0) {
          await writeFile(
            command.args[outputIndex + 1]!,
            JSON.stringify({
              language: 'en',
              cues: [
                {
                  id: 'cue-000001',
                  startMs: 0,
                  endMs: 2_000,
                  text: 'First speaker.',
                  sourceCueIds: ['cue-000001'],
                  speakerId: 'speaker-0001',
                },
                {
                  id: 'cue-000002',
                  startMs: 1_400,
                  endMs: 2_800,
                  text: 'Overlapping speaker.',
                  sourceCueIds: ['cue-000002'],
                  speakerId: 'speaker-0002',
                },
              ],
              speakerSegments: [
                { speakerId: 'speaker-0001', startMs: 0, endMs: 2_000 },
                { speakerId: 'speaker-0002', startMs: 1_400, endMs: 2_800 },
              ],
            }),
          );
        }
        return { stdout: '', stderr: '' };
      });
      const transcription: SubtitleTranscriptionRuntime = {
        kind: 'moss',
        profile: 'nvidia',
        backend: 'cuda',
        pythonPath: join(directory, 'python.exe'),
        pythonPackagesPath: join(directory, 'python-packages'),
        nativeLibraryPath: join(directory, 'transcribe.dll'),
        modelPath: join(directory, 'MOSS-Q5.gguf'),
        environment: {
          TRANSCRIBE_LIBRARY: join(directory, 'transcribe.dll'),
        },
      };
      const producer = new MediaSubtitleTranscriptionProducer(
        runtimeResolver(transcription, directory),
        {
          now: () => 123,
          commandRunner: { run },
          logicalCpuCount: 12,
        },
      );

      const result = await producer.produce(
        request(directory),
        new AbortController().signal,
      );
      const track = JSON.parse(await readFile(result.filePath, 'utf8')) as unknown;

      expect(isSubtitleSourceTrackV1(track)).toBe(true);
      expect(track).toMatchObject({
        sourceRevision: 'video-revision',
        language: 'en',
        generatedTime: 123,
        engine: {
          id: 'transcribe.cpp',
          model: 'MOSS-Transcribe-Diarize-Q5_K_M',
          backend: 'cuda',
        },
        speakerAnalysis: {
          method: 'joint-transcription-diarization',
          supportsOverlappingTranscription: true,
        },
      });
      expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[0]![0].args).toEqual(
        expect.arrayContaining(['-c:a', 'pcm_f32le', '-f', 'f32le']),
      );
      expect(run.mock.calls[1]![0]).toMatchObject({
        command: transcription.pythonPath,
        env: transcription.environment,
      });
      expect(run.mock.calls[1]![0].args).toEqual(
        expect.arrayContaining([
          '--model',
          transcription.modelPath,
          '--backend',
          'cuda',
          '--threads',
          '6',
        ]),
      );
    });
  });

  it('keeps SenseVoice on CPU and adds sherpa-onnx speaker attribution', async () => {
    await withDirectory(async (directory) => {
      const run = vi.fn<ExternalCommandRunnerApi['run']>(async (command) => {
        if (command.command.endsWith('vad.exe')) {
          return { stdout: '0 2000\n2000 4000\n', stderr: '' };
        }
        if (command.command.endsWith('sensevoice.exe')) {
          return {
            stdout:
              '<|zh|><|NEUTRAL|><|Speech|><|woitn|>第一句话。' +
              '<|zh|><|NEUTRAL|><|Speech|><|woitn|>第二句话。',
            stderr: '',
          };
        }
        if (command.command.endsWith('diarization.exe')) {
          return {
            stdout:
              '0.000 -- 2.100 speaker_00\n' +
              '1.800 -- 2.300 speaker_01\n' +
              '2.300 -- 4.000 speaker_01\n',
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });
      const transcription: SubtitleTranscriptionRuntime = {
        kind: 'sensevoice',
        profile: 'cpu',
        executablePath: join(directory, 'sensevoice.exe'),
        vadExecutablePath: join(directory, 'vad.exe'),
        modelPath: join(directory, 'sensevoice.gguf'),
        vadModelPath: join(directory, 'vad.gguf'),
        speakerDiarizationExecutablePath: join(directory, 'diarization.exe'),
        speakerSegmentationModelPath: join(directory, 'segmentation.onnx'),
        speakerEmbeddingModelPath: join(directory, 'embedding.onnx'),
      };
      const producer = new MediaSubtitleTranscriptionProducer(
        runtimeResolver(transcription, directory),
        {
          now: () => 456,
          commandRunner: { run },
          logicalCpuCount: 8,
        },
      );

      const result = await producer.produce(
        request(directory),
        new AbortController().signal,
      );
      const track = JSON.parse(await readFile(result.filePath, 'utf8')) as unknown;

      expect(isSubtitleSourceTrackV1(track)).toBe(true);
      expect(track).toMatchObject({
        language: 'zh-Hans',
        engine: {
          id: 'funasr-llama.cpp+sherpa-onnx',
          backend: 'cpu-avx2',
        },
        speakerAnalysis: {
          method: 'post-hoc-diarization',
          supportsOverlappingTranscription: false,
        },
        cues: [
          { text: '第一句话。', speakerId: 'speaker-0001' },
          { text: '第二句话。', speakerId: 'speaker-0002' },
        ],
      });
      expect(run).toHaveBeenCalledTimes(4);
      expect(run.mock.calls[3]![0].args).toEqual(
        expect.arrayContaining([
          '--clustering.cluster-threshold=0.7',
          `--segmentation.pyannote-model=${transcription.speakerSegmentationModelPath}`,
          `--embedding.model=${transcription.speakerEmbeddingModelPath}`,
        ]),
      );
    });
  });

  it('preserves cancellation instead of committing an artifact', async () => {
    await withDirectory(async (directory) => {
      const aborted = new DOMException('cancelled', 'AbortError');
      const transcription: SubtitleTranscriptionRuntime = {
        kind: 'sensevoice',
        profile: 'cpu',
        executablePath: 'sensevoice.exe',
        vadExecutablePath: 'vad.exe',
        modelPath: 'sensevoice.gguf',
        vadModelPath: 'vad.gguf',
        speakerDiarizationExecutablePath: 'diarization.exe',
        speakerSegmentationModelPath: 'segmentation.onnx',
        speakerEmbeddingModelPath: 'embedding.onnx',
      };
      const producer = new MediaSubtitleTranscriptionProducer(
        runtimeResolver(transcription, directory),
        {
          commandRunner: {
            run: vi.fn(async () => {
              throw aborted;
            }),
          },
        },
      );

      await expect(
        producer.produce(request(directory), new AbortController().signal),
      ).rejects.toBe(aborted);
    });
  });
});
