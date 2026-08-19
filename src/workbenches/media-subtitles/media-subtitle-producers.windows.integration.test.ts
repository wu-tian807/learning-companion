import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  isSubtitleSourceTrackV1,
  isSubtitleTranslationTrackV1,
} from './contracts';
import type { MediaSubtitleRuntimeResolverApi } from './external-libraries/media-subtitle-runtime';
import {
  MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
  MediaSubtitleTranscriptionProducer,
} from './transcription-producer';
import {
  MediaSubtitleTranslationProducer,
  createSubtitleTranslationArtifactKey,
} from './translation-producer';

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
  it('recognizes a short fixture and translates every resulting cue', async () => {
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
      requireTranscription: async () => nvidia
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
      requireFastTranslation: async () => {
        throw new Error('not used');
      },
      requireQualityTranslation: async () => ({
        executablePath: join(
          installationRoot,
          'translation',
          'hymt',
          'engine',
          'llama-server.exe',
        ),
        modelPath: join(
          installationRoot,
          'translation',
          'hymt',
          'models',
          'Hy-MT2-1.8B-Q4_K_M.gguf',
        ),
        backend: nvidia ? 'vulkan' : 'cpu',
      }),
    };
    const directory = await mkdtemp(join(tmpdir(), 'lc-media-subtitle-real-'));
    try {
      const fixture = resolve(
        'demos',
        'subtitle-generation',
        '.fixtures',
        'en-us-classroom.wav',
      );
      const transcription = new MediaSubtitleTranscriptionProducer(runtimes);
      const sourceArtifact = await transcription.produce({
        artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
        workspacePath: directory,
        stagingDirectory: directory,
        source: {
          assetId: 'fixture',
          mediaType: 'audio/wav',
          absolutePath: fixture,
          revision: 'fixture-revision',
        },
      }, new AbortController().signal);
      const source = JSON.parse(
        await readFile(sourceArtifact.filePath, 'utf8'),
      ) as unknown;
      expect(isSubtitleSourceTrackV1(source)).toBe(true);
      if (!isSubtitleSourceTrackV1(source) || source.language !== 'en') {
        throw new Error('Integration fixture was not recognized as English');
      }

      const progress: string[] = [];
      const translation = new MediaSubtitleTranslationProducer(
        runtimes,
        ({ cue }) => progress.push(cue.sourceCueId),
      );
      const translatedArtifact = await translation.produce({
        artifactKey: createSubtitleTranslationArtifactKey('en', 'zh-Hans'),
        workspacePath: directory,
        stagingDirectory: directory,
        source: {
          assetId: 'fixture',
          mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
          absolutePath: sourceArtifact.filePath,
          revision: 'source-artifact-revision',
        },
      }, new AbortController().signal);
      const translated = JSON.parse(
        await readFile(translatedArtifact.filePath, 'utf8'),
      ) as unknown;

      expect(isSubtitleTranslationTrackV1(translated)).toBe(true);
      if (!isSubtitleTranslationTrackV1(translated)) return;
      expect(translated.cues).toHaveLength(source.cues.length);
      expect(progress).toHaveLength(source.cues.length);
      expect(translated.cues.every(({ text }) => text.trim().length > 0)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 5 * 60_000);
});
