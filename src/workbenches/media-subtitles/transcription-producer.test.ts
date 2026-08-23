import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ExternalCommandRunnerApi } from '../../main/external-libraries/external-command-runner';
import type { MediaSubtitleRuntimeResolverApi } from './external-libraries/media-subtitle-runtime';
import {
  MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
  MediaSubtitleTranscriptionProducer,
} from './transcription-producer';
import { mergeWhisperSubtitleCues } from './transcription-output-adapter';

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
      expect(runner.run).toHaveBeenLastCalledWith(expect.objectContaining({
        args: expect.arrayContaining([
          '-nfa',
          '-dtw',
          'large.v3.turbo',
          '-ojf',
        ]),
      }));
      expect(runner.run).toHaveBeenLastCalledWith(expect.objectContaining({
        args: expect.not.arrayContaining(['-fa', '--vad', '-vm']),
      }));
    });
  });

  it('uses DTW points on the original audio timeline instead of early token offsets', async () => {
    await withDirectory(async (directory) => {
      const phrases = [
        ['今天我们验证一条本地字幕生成链路', 42, 352],
        ['视频播放不需要等待转录完成', 470, 732],
        ['系统应该尽快给出第一条字幕', 852, 1_110],
        ['并在后台继续处理后续内容', 1_168, 1_416],
        ['最终结果会保存为可以重复使用的字幕文件', 1_530, 1_920],
      ] as const;
      const runner: ExternalCommandRunnerApi = {
        run: vi.fn(async (request) => {
          const outputIndex = request.args.indexOf('-of');
          if (outputIndex >= 0) {
            const outputPrefix = request.args[outputIndex + 1];
            await writeFile(`${outputPrefix}.json`, JSON.stringify({
              result: { language: 'zh' },
              transcription: phrases.map(([text, firstDtw, lastDtw], index) => ({
                offsets: { from: index * 3_000, to: (index + 1) * 3_000 },
                text,
                tokens: [...text].map((character, tokenIndex) => ({
                  offsets: {
                    from: index * 3_000 + tokenIndex * 10,
                    to: index * 3_000 + tokenIndex * 10 + 10,
                  },
                  t_dtw: Math.round(
                    firstDtw +
                      ((lastDtw - firstDtw) * tokenIndex) / (text.length - 1),
                  ),
                  text: character,
                })),
              })),
            }));
          }
          return { stdout: '', stderr: '' };
        }),
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

      expect(track.cues.map((cue: { startMs: number; endMs: number }) => [
        cue.startMs,
        cue.endMs,
      ])).toEqual([
        [170, 3_720],
        [4_450, 7_520],
        [8_270, 11_300],
        [11_430, 14_360],
        [15_050, 19_400],
      ]);
    });
  });

  it('splits one oversized Whisper segment using its token timestamps', async () => {
    await withDirectory(async (directory) => {
      const runner: ExternalCommandRunnerApi = {
        run: vi.fn(async (request) => {
          const outputIndex = request.args.indexOf('-of');
          if (outputIndex >= 0) {
            const outputPrefix = request.args[outputIndex + 1];
            await writeFile(`${outputPrefix}.json`, JSON.stringify({
              result: { language: 'zh' },
              transcription: [{
                offsets: { from: 130, to: 19_210 },
                text: '今天我们验证一条本地字幕生成链路，视频播放不需要等待转录完成，系统应该尽快给出第一条字幕，并在后台继续处理后续内容，最终结果会保存为可以重复使用的字幕文件。',
                tokens: [
                  { offsets: { from: 0, to: 0 }, text: '[_BEG_]' },
                  { offsets: { from: 130, to: 3_430 }, text: '今天我们验证一条本地字幕生成链路，' },
                  { offsets: { from: 3_790, to: 6_630 }, text: '视频播放不需要等待转录完成，' },
                  { offsets: { from: 6_630, to: 9_820 }, text: '系统应该尽快给出第一条字幕，' },
                  { offsets: { from: 9_820, to: 13_240 }, text: '并在后台继续处理后续内容，' },
                  { offsets: { from: 13_240, to: 17_140 }, text: '最终结果会保存为可以重复使用的字幕文件。' },
                  { offsets: { from: 17_140, to: 17_140 }, text: '[_TT_857]' },
                ],
              }],
            }));
          }
          return { stdout: '', stderr: '' };
        }),
      };
      const producer = new MediaSubtitleTranscriptionProducer(
        runtimeResolver({
          kind: 'whisper',
          profile: 'nvidia',
          executablePath: join(directory, 'whisper.exe'),
          modelPath: join(directory, 'whisper.bin'),
          vadModelPath: join(directory, 'vad.bin'),
        }, directory),
        {
          now: () => 123,
          commandRunner: runner,
          logicalCpuCount: 8,
        },
      );

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

      expect(track.cues).toHaveLength(5);
      expect(track.cues.map((cue: { startMs: number; endMs: number }) => [
        cue.startMs,
        cue.endMs,
      ])).toEqual([
        [130, 3_430],
        [3_790, 6_630],
        [6_630, 9_820],
        [9_820, 13_240],
        [13_240, 17_140],
      ]);
      expect(track.cues.flatMap(
        (cue: { sourceCueIds: readonly string[] }) => cue.sourceCueIds,
      )).toHaveLength(5);
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

  it('keeps one real VAD interval instead of estimating SenseVoice sub-cue times', async () => {
    await withDirectory(async (directory) => {
      const runner: ExternalCommandRunnerApi = {
        run: vi.fn(async (request) => {
          if (request.command.endsWith('vad.exe')) {
            return { stdout: '100 19100\n', stderr: '' };
          }
          if (request.command.endsWith('sensevoice.exe')) {
            return {
              stdout: '<|zh|><|NEUTRAL|><|Speech|><|woitn|>第一句很长，第二句也很长，第三句仍然很长，不能按字符比例猜测时间。',
              stderr: '',
            };
          }
          return { stdout: '', stderr: '' };
        }),
      };
      const producer = new MediaSubtitleTranscriptionProducer(
        runtimeResolver({
          kind: 'sensevoice',
          profile: 'cpu',
          executablePath: join(directory, 'sensevoice.exe'),
          vadExecutablePath: join(directory, 'vad.exe'),
          modelPath: join(directory, 'sensevoice.gguf'),
          vadModelPath: join(directory, 'vad.gguf'),
        }, directory),
        { commandRunner: runner },
      );

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

      expect(track.cues).toEqual([
        expect.objectContaining({
          startMs: 100,
          endMs: 19_100,
          text: '第一句很长，第二句也很长，第三句仍然很长，不能按字符比例猜测时间。',
        }),
      ]);
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
