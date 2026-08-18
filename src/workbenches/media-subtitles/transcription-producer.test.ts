import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ExternalCommandRunnerApi } from '../../main/external-libraries/external-command-runner';
import type { MediaSubtitleRuntimeResolverApi } from './external-libraries/media-subtitle-runtime';
import {
  MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
  MediaSubtitleTranscriptionProducer,
  mergeWhisperSubtitleCues,
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
  transcription: Awaited<
    ReturnType<MediaSubtitleRuntimeResolverApi['requireTranscription']>
  >,
  directory: string,
): MediaSubtitleRuntimeResolverApi {
  return {
    requireMediaDecoder: vi.fn(async () => ({
      ffmpegPath: join(directory, 'ffmpeg.exe'),
      ffprobePath: join(directory, 'ffprobe.exe'),
    })),
    requireTranscription: vi.fn(async () => transcription),
    requireFastTranslation: vi.fn(async () => {
      throw new Error('not used');
    }),
    requireQualityTranslation: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
}

describe('MediaSubtitleTranscriptionProducer', () => {
  it('merges nearby Whisper fragments without losing source cue identity', () => {
    const cues = mergeWhisperSubtitleCues([
      { id: 'raw-1', startMs: 0, endMs: 300, text: 'GPT', sourceCueIds: ['raw-1'] },
      { id: 'raw-2', startMs: 300, endMs: 600, text: '大语言', sourceCueIds: ['raw-2'] },
      { id: 'raw-3', startMs: 600, endMs: 900, text: '模型。', sourceCueIds: ['raw-3'] },
      { id: 'raw-4', startMs: 2_000, endMs: 2_400, text: '下一句', sourceCueIds: ['raw-4'] },
    ], 'zh-Hans');

    expect(cues).toEqual([
      {
        id: 'cue-000001',
        startMs: 0,
        endMs: 900,
        text: 'GPT 大语言模型。',
        sourceCueIds: ['raw-1', 'raw-2', 'raw-3'],
      },
      {
        id: 'cue-000002',
        startMs: 2_000,
        endMs: 2_400,
        text: '下一句',
        sourceCueIds: ['raw-4'],
      },
    ]);
  });

  it('produces a validated Whisper artifact from the normalized audio', async () => {
    await withDirectory(async (directory) => {
      const runner: ExternalCommandRunnerApi = {
        run: vi.fn(async (request) => {
          const outputIndex = request.args.indexOf('-of');
          if (outputIndex >= 0) {
            const outputPrefix = request.args[outputIndex + 1];
            await writeFile(`${outputPrefix}.json`, JSON.stringify({
              result: { language: 'zh' },
              transcription: [
                { offsets: { from: 0, to: 300 }, text: 'GPT' },
                { offsets: { from: 300, to: 800 }, text: '大语言模型。' },
              ],
            }));
          }
          return { stdout: '', stderr: '' };
        }),
      };
      const runtimes = runtimeResolver({
        kind: 'whisper',
        profile: 'nvidia',
        executablePath: join(directory, 'whisper.exe'),
        modelPath: join(directory, 'whisper.bin'),
        vadModelPath: join(directory, 'vad.bin'),
      }, directory);
      const producer = new MediaSubtitleTranscriptionProducer(runtimes, {
        now: () => 123,
        commandRunner: runner,
        logicalCpuCount: 8,
      });

      const result = await producer.produce({
        artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
        workspacePath: directory,
        stagingDirectory: directory,
        source: {
          assetId: 'video',
          mediaType: 'video/mp4',
          absolutePath: join(directory, 'video.mp4'),
          revision: 'video-revision',
        },
      }, new AbortController().signal);
      const track = JSON.parse(await readFile(result.filePath, 'utf8'));

      expect(track).toMatchObject({
        sourceRevision: 'video-revision',
        language: 'zh-Hans',
        generatedTime: 123,
        engine: { id: 'whisper.cpp', backend: 'cuda' },
      });
      expect(track.cues).toEqual([
        expect.objectContaining({
          startMs: 0,
          endMs: 800,
          text: 'GPT 大语言模型。',
          sourceCueIds: ['raw-000001', 'raw-000002'],
        }),
      ]);
      expect(runner.run).toHaveBeenCalledTimes(2);
    });
  });

  it('runs the CPU VAD before SenseVoice and creates timed cues', async () => {
    await withDirectory(async (directory) => {
      const commands: string[] = [];
      const runner: ExternalCommandRunnerApi = {
        run: vi.fn(async (request) => {
          commands.push(request.command);
          if (request.command.endsWith('vad.exe')) {
            return { stdout: '0 2000\n', stderr: '' };
          }
          if (request.command.endsWith('sensevoice.exe')) {
            return {
              stdout: '<|zh|><|NEUTRAL|><|Speech|><|woitn|>这是一个字幕测试。',
              stderr: '',
            };
          }
          return { stdout: '', stderr: '' };
        }),
      };
      const runtimes = runtimeResolver({
        kind: 'sensevoice',
        profile: 'cpu',
        executablePath: join(directory, 'sensevoice.exe'),
        vadExecutablePath: join(directory, 'vad.exe'),
        modelPath: join(directory, 'sensevoice.gguf'),
        vadModelPath: join(directory, 'vad.gguf'),
      }, directory);
      const producer = new MediaSubtitleTranscriptionProducer(runtimes, {
        now: () => 456,
        commandRunner: runner,
        logicalCpuCount: 8,
      });

      const result = await producer.produce({
        artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
        workspacePath: directory,
        stagingDirectory: directory,
        source: {
          assetId: 'video',
          mediaType: 'video/mp4',
          absolutePath: join(directory, 'video.mp4'),
          revision: 'video-revision',
        },
      }, new AbortController().signal);
      const track = JSON.parse(await readFile(result.filePath, 'utf8'));

      expect(commands.slice(-2)).toEqual([
        join(directory, 'vad.exe'),
        join(directory, 'sensevoice.exe'),
      ]);
      expect(track).toMatchObject({
        language: 'zh-Hans',
        engine: { id: 'funasr-llama.cpp', backend: 'cpu-avx2' },
        cues: [
          { startMs: 0, endMs: 2000, text: '这是一个字幕测试。' },
        ],
      });
    });
  });

  it('preserves cancellation instead of committing a failed artifact', async () => {
    await withDirectory(async (directory) => {
      const aborted = new DOMException('cancelled', 'AbortError');
      const runner: ExternalCommandRunnerApi = {
        run: vi.fn(async () => { throw aborted; }),
      };
      const producer = new MediaSubtitleTranscriptionProducer(
        runtimeResolver({
          kind: 'whisper',
          profile: 'nvidia',
          executablePath: join(directory, 'whisper.exe'),
          modelPath: join(directory, 'whisper.bin'),
          vadModelPath: join(directory, 'vad.bin'),
        }, directory),
        { commandRunner: runner },
      );

      await expect(producer.produce({
        artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
        workspacePath: directory,
        stagingDirectory: directory,
        source: {
          assetId: 'video',
          mediaType: 'video/mp4',
          absolutePath: join(directory, 'video.mp4'),
          revision: 'video-revision',
        },
      }, new AbortController().signal)).rejects.toBe(aborted);
    });
  });
});
