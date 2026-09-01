import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ExternalCommandRunnerApi } from '../../main/external-libraries/external-command-runner';
import type {
  MediaSubtitleRuntime,
  MediaSubtitleRuntimeResolverApi,
  SubtitleTranscriptionRuntime,
} from './external-libraries/media-subtitle-runtime';
import {
  MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
  MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_VERSION,
  MediaSubtitleTranscriptionProducer,
} from './transcription-producer';
import {
  SubtitleTranscriptionProgressHub,
  type SubtitleTranscriptionProgress,
} from './transcription-progress';

async function inTemp(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'lc-subtitle-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function resolver(
  directory: string,
  transcription: SubtitleTranscriptionRuntime,
): MediaSubtitleRuntimeResolverApi {
  const runtime: MediaSubtitleRuntime = {
    decoder: {
      ffmpegPath: join(directory, 'ffmpeg.exe'),
      ffprobePath: join(directory, 'ffprobe.exe'),
    },
    transcription,
    speakerDiarization: {
      executablePath: join(directory, 'diarization.exe'),
      segmentationModelPath: join(directory, 'segmentation.onnx'),
      embeddingModelPath: join(directory, 'embedding.onnx'),
    },
  };
  return {
    requireMediaDecoder: vi.fn(async () => runtime.decoder),
    requireTranscription: vi.fn(async () => runtime.transcription),
    withRuntime: async (signal, operation) =>
      operation(runtime, signal ?? new AbortController().signal),
  };
}

function request(directory: string, mediaType: string) {
  return {
    artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
    workspacePath: directory,
    stagingDirectory: directory,
    source: {
      assetId: 'media',
      mediaType,
      absolutePath: join(directory, 'media.bin'),
      revision: 'revision',
    },
  };
}

async function readTrack(filePath: string) {
  return JSON.parse(await readFile(filePath, 'utf8')) as {
    speakerAnalysis?: unknown;
    cues: Array<{ speakerId?: string; text: string }>;
    engine: { id: string };
  };
}

function whisper(directory: string): SubtitleTranscriptionRuntime {
  return {
    kind: 'whisper',
    executablePath: join(directory, 'whisper.exe'),
    modelPath: 'whisper.bin',
    vadModelPath: 'vad.bin',
  };
}

function senseVoice(directory: string): SubtitleTranscriptionRuntime {
  return {
    kind: 'sensevoice',
    executablePath: join(directory, 'sensevoice.exe'),
    vadExecutablePath: join(directory, 'vad.exe'),
    modelPath: 'sensevoice.gguf',
    vadModelPath: 'vad.gguf',
  };
}

function producer(
  directory: string,
  transcription: SubtitleTranscriptionRuntime,
  run: ExternalCommandRunnerApi['run'],
  progress?: SubtitleTranscriptionProgressHub,
) {
  return new MediaSubtitleTranscriptionProducer(
    resolver(directory, transcription),
    { now: () => 123, commandRunner: { run }, logicalCpuCount: 8, progress },
  );
}

async function produceTrack(
  instance: MediaSubtitleTranscriptionProducer,
  directory: string,
  mediaType: string,
) {
  const result = await instance.produce(
    request(directory, mediaType),
    new AbortController().signal,
  );
  return readTrack(result.filePath);
}

describe('MediaSubtitleTranscriptionProducer', () => {
  it('restores Whisper video subtitles without speaker analysis', async () => {
    await inTemp(async (directory) => {
      const progress = new SubtitleTranscriptionProgressHub();
      const updates: SubtitleTranscriptionProgress[] = [];
      progress.subscribe((update) => updates.push(update));
      const run = vi.fn<ExternalCommandRunnerApi['run']>(async (command) => {
        const output = command.args.indexOf('-of');
        if (output >= 0) {
          command.onStdout?.(
            '[00:00:00.000 --> 00:00:00.800] GPT\n',
          );
          command.onStdout?.(
            '[00:00:00.800 --> 00:00:02.000] 大语言模型。\n',
          );
          await writeFile(
            `${command.args[output + 1]}.json`,
            JSON.stringify({
              result: { language: 'zh' },
              transcription: [
                { offsets: { from: 0, to: 800 }, text: 'GPT' },
                { offsets: { from: 800, to: 2_000 }, text: '大语言模型。' },
              ],
            }),
          );
        }
        return { stdout: '', stderr: '' };
      });
      const track = await produceTrack(
        producer(directory, whisper(directory), run, progress),
        directory,
        'video/mp4',
      );

      expect(MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_VERSION).toBe('6');
      expect(track.engine.id).toBe('whisper.cpp');
      expect(track.cues.map(({ text }) => text)).toEqual(['GPT 大语言模型。']);
      expect(track.speakerAnalysis).toBeUndefined();
      expect(
        updates.some(
          ({ track: partial }) =>
            partial.cues.length === 1 && partial.cues[0]?.text === 'GPT',
        ),
      ).toBe(true);
      expect(
        updates.some(
          ({ track: partial }) => partial.cues.length === 2,
        ),
      ).toBe(true);
      const whisperCommand = run.mock.calls
        .map(([command]) => command)
        .find(({ command }) => command.endsWith('whisper.exe'));
      expect(whisperCommand?.args).toEqual(
        expect.arrayContaining(['-fa', '--vad', '-vm', 'vad.bin', '-pp']),
      );
      expect(whisperCommand?.args).not.toContain('-nfa');
      expect(whisperCommand?.args).not.toContain('-dtw');
      expect(run).toHaveBeenCalledTimes(2);
    });
  });

  it('adds Sherpa speaker labels immediately for audio', async () => {
    await inTemp(async (directory) => {
      const run = vi.fn<ExternalCommandRunnerApi['run']>(async ({ command }) => {
        if (command.endsWith('vad.exe')) {
          return { stdout: '0 2000\n2000 4000\n', stderr: '' };
        }
        if (command.endsWith('sensevoice.exe')) {
          return {
            stdout:
              '<|zh|><|N|><|S|><|T|>第一位说话。' +
              '<|zh|><|N|><|S|><|T|>第二位回答。',
            stderr: '',
          };
        }
        if (command.endsWith('diarization.exe')) {
          return {
            stdout: '0.000 -- 2.100 speaker_4\n1.900 -- 4.000 speaker_7\n',
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });
      const track = await produceTrack(
        producer(directory, senseVoice(directory), run),
        directory,
        'audio/mpeg',
      );

      expect(track.cues.map(({ speakerId }) => speakerId)).toEqual([
        'speaker-0001',
        'speaker-0002',
      ]);
      expect(track.speakerAnalysis).toMatchObject({
        method: 'post-hoc-diarization',
      });
      expect(run).toHaveBeenCalledTimes(4);
    });
  });

  it('preserves cancellation', async () => {
    const aborted = new DOMException('cancelled', 'AbortError');
    const instance = producer(
      'C:\\runtime',
      whisper('C:\\runtime'),
      vi.fn(async () => Promise.reject(aborted)),
    );
    await expect(
      instance.produce(
        request('C:\\runtime', 'video/mp4'),
        new AbortController().signal,
      ),
    ).rejects.toBe(aborted);
  });
});
