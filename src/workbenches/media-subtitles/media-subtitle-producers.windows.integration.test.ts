import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isSubtitleSourceTrackV1,
  isTranslatableSubtitleLanguage,
} from './contracts';
import type { MediaSubtitleRuntimeResolverApi } from './external-libraries/media-subtitle-runtime';
import {
  MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
  MediaSubtitleTranscriptionProducer,
} from './transcription-producer';

const runIntegration =
  process.platform === 'win32' &&
  process.env.RUN_MEDIA_SUBTITLE_INTEGRATION === '1';
const integrationDescribe = runIntegration ? describe : describe.skip;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

integrationDescribe('installed media subtitle component', () => {
  it(
    'recognizes a short fixture with the installed local engine',
    async () => {
      const installationRoot =
        process.env.MEDIA_SUBTITLE_RUNTIME_ROOT ??
        join(
          homedir(),
          'Documents',
          'Learning Companion',
          'externalLib',
          'media-subtitles',
          '2026.08.16',
          'win32-x64',
          'runtime',
        );
      const whisperExecutable = join(
        installationRoot,
        'transcription',
        'whisper',
        'engine',
        'Release',
        'whisper-cli.exe',
      );
      const nvidia = await exists(whisperExecutable);
      const runtimes: MediaSubtitleRuntimeResolverApi = {
        requireMediaDecoder: async () => ({
          ffmpegPath: join(
            installationRoot,
            'decoder',
            'engine',
            'ffmpeg-8.1.2-essentials_build',
            'bin',
            'ffmpeg.exe',
          ),
          ffprobePath: join(
            installationRoot,
            'decoder',
            'engine',
            'ffmpeg-8.1.2-essentials_build',
            'bin',
            'ffprobe.exe',
          ),
        }),
        requireTranscription: async () =>
          nvidia
            ? {
                kind: 'whisper',
                profile: 'nvidia',
                executablePath: whisperExecutable,
                modelPath: join(
                  installationRoot,
                  'transcription',
                  'whisper',
                  'models',
                  'ggml-large-v3-turbo-q5_0.bin',
                ),
                vadModelPath: join(
                  installationRoot,
                  'transcription',
                  'whisper',
                  'models',
                  'ggml-silero-v6.2.0.bin',
                ),
              }
            : {
                kind: 'sensevoice',
                profile: 'cpu',
                executablePath: join(
                  installationRoot,
                  'transcription',
                  'sensevoice',
                  'engine',
                  'llama-funasr-sensevoice.exe',
                ),
                vadExecutablePath: join(
                  installationRoot,
                  'transcription',
                  'sensevoice',
                  'engine',
                  'llama-funasr-vad.exe',
                ),
                modelPath: join(
                  installationRoot,
                  'transcription',
                  'sensevoice',
                  'models',
                  'sensevoice-small-q8.gguf',
                ),
                vadModelPath: join(
                  installationRoot,
                  'transcription',
                  'sensevoice',
                  'models',
                  'fsmn-vad.gguf',
                ),
              },
        async withRuntime(signal, operation) {
          return operation(
            {
              decoder: await this.requireMediaDecoder(),
              transcription: await this.requireTranscription(),
            },
            signal ?? new AbortController().signal,
          );
        },
      };
      const directory = await mkdtemp(
        join(tmpdir(), 'lc-media-subtitle-real-'),
      );
      try {
        const fixture =
          process.env.MEDIA_SUBTITLE_INTEGRATION_FIXTURE ??
          resolve(
            'demos',
            'subtitle-generation',
            '.fixtures',
            'en-us-classroom.wav',
          );
        const expectedLanguage =
          process.env.MEDIA_SUBTITLE_INTEGRATION_LANGUAGE ?? 'en';
        if (!isTranslatableSubtitleLanguage(expectedLanguage)) {
          throw new Error(
            'MEDIA_SUBTITLE_INTEGRATION_LANGUAGE must be en or zh-Hans',
          );
        }
        const transcription = new MediaSubtitleTranscriptionProducer(runtimes);
        const sourceArtifact = await transcription.produce(
          {
            artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
            workspacePath: directory,
            stagingDirectory: directory,
            source: {
              assetId: 'fixture',
              mediaType: 'audio/wav',
              absolutePath: fixture,
              revision: 'fixture-revision',
            },
          },
          new AbortController().signal,
        );
        const source = JSON.parse(
          await readFile(sourceArtifact.filePath, 'utf8'),
        ) as unknown;
        expect(isSubtitleSourceTrackV1(source)).toBe(true);
        if (
          !isSubtitleSourceTrackV1(source) ||
          source.language !== expectedLanguage
        ) {
          throw new Error(
            `Integration fixture was not recognized as ${expectedLanguage}`,
          );
        }
        if (nvidia) {
          expect(
            source.cues.every(({ startMs, endMs }) => endMs - startMs <= 6_000),
          ).toBe(true);
        }
        const expectedCueCount = Number(
          process.env.MEDIA_SUBTITLE_INTEGRATION_EXPECTED_CUES,
        );
        if (Number.isSafeInteger(expectedCueCount) && expectedCueCount > 0) {
          expect(source.cues).toHaveLength(expectedCueCount);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    5 * 60_000,
  );
});
