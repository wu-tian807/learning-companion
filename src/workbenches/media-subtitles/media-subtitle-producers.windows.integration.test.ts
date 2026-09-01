import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  ExternalLibraryRuntime,
  ExternalLibraryServiceApi,
} from '../../main/external-libraries/external-library-service';
import {
  isSubtitleSourceTrackV1,
  isTranslatableSubtitleLanguage,
} from './contracts';
import {
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
  MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
} from './external-libraries/definitions';
import { MediaSubtitleRuntimeResolver } from './external-libraries/media-subtitle-runtime';
import {
  MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
  MediaSubtitleTranscriptionProducer,
} from './transcription-producer';

const runIntegration =
  process.platform === 'win32' &&
  process.env.RUN_MEDIA_SUBTITLE_INTEGRATION === '1';
const integrationDescribe = runIntegration ? describe : describe.skip;

integrationDescribe('installed media subtitle component', () => {
  it(
    'recognizes a real fixture and emits speaker-aware subtitles',
    async () => {
      const installationRoot = process.env.MEDIA_SUBTITLE_RUNTIME_ROOT;
      if (!installationRoot) {
        throw new Error('MEDIA_SUBTITLE_RUNTIME_ROOT is required');
      }
      const variantId =
        process.env.MEDIA_SUBTITLE_VARIANT === MEDIA_SUBTITLE_CPU_VARIANT_ID
          ? MEDIA_SUBTITLE_CPU_VARIANT_ID
          : MEDIA_SUBTITLE_NVIDIA_VARIANT_ID;
      const runtime: ExternalLibraryRuntime = {
        libraryId: MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
        variantId,
        runtimeDirectory: resolve(installationRoot),
      };
      const externalLibraries = {
        async requireRuntime() {
          return runtime;
        },
        async withRuntime<T>(
          _libraryId: string,
          signal: AbortSignal | undefined,
          operation: (
            value: ExternalLibraryRuntime,
            usageSignal: AbortSignal,
          ) => Promise<T>,
        ) {
          return operation(
            runtime,
            signal ?? new AbortController().signal,
          );
        },
      } as unknown as ExternalLibraryServiceApi;
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
        const producer = new MediaSubtitleTranscriptionProducer(
          new MediaSubtitleRuntimeResolver(externalLibraries),
        );
        const sourceArtifact = await producer.produce(
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
        if (!isSubtitleSourceTrackV1(source)) {
          throw new Error('subtitle artifact is invalid');
        }
        expect(source.language).toBe(expectedLanguage);
        expect(source.speakerAnalysis).toBeDefined();
        expect(source.cues.every((cue) => cue.speakerId !== undefined)).toBe(
          true,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    20 * 60_000,
  );
});
