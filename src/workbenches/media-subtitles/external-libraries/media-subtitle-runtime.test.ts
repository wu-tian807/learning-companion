import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ExternalLibraryServiceApi } from '../../../main/external-libraries/external-library-service';
import {
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
  MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
} from './definitions';
import { MediaSubtitleRuntimeResolver } from './media-subtitle-runtime';

function createResolver(variantId: string) {
  const runtime = {
    libraryId: MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
    variantId,
    runtimeDirectory: join('C:\\externalLib', 'media-subtitles', 'runtime'),
  };
  const requireRuntime = vi.fn<ExternalLibraryServiceApi['requireRuntime']>(
    async () => runtime,
  );
  const withRuntime = vi.fn<ExternalLibraryServiceApi['withRuntime']>(
    async (_libraryId, signal, operation) =>
      operation(runtime, signal ?? new AbortController().signal),
  );
  return {
    requireRuntime,
    resolver: new MediaSubtitleRuntimeResolver({
      requireRuntime,
      withRuntime,
    } as unknown as ExternalLibraryServiceApi),
  };
}

describe('MediaSubtitleRuntimeResolver', () => {
  it.each([
    [MEDIA_SUBTITLE_NVIDIA_VARIANT_ID, 'whisper', 'whisper-cli.exe'],
    [
      MEDIA_SUBTITLE_CPU_VARIANT_ID,
      'sensevoice',
      'llama-funasr-sensevoice.exe',
    ],
  ] as const)(
    'resolves %s transcription and the same Sherpa ownership',
    async (variantId, expectedKind, executableName) => {
      const { resolver } = createResolver(variantId);
      const resolved = await resolver.withRuntime(
        undefined,
        async (runtime) => runtime,
      );

      expect(resolved.decoder.ffmpegPath).toContain('ffmpeg.exe');
      expect(resolved.transcription).toMatchObject({
        kind: expectedKind,
        executablePath: expect.stringContaining(executableName),
      });
      expect(resolved.speakerDiarization).toMatchObject({
        executablePath: expect.stringContaining(
          'sherpa-onnx-offline-speaker-diarization.exe',
        ),
        segmentationModelPath: expect.stringContaining(
          join('speaker', 'models', 'pyannote-segmentation-3.0.int8.onnx'),
        ),
        embeddingModelPath: expect.stringContaining(
          join('speaker', 'models', '3dspeaker-campplus-zh-en.onnx'),
        ),
      });
    },
  );

  it('rejects obsolete package variants', async () => {
    await expect(
      createResolver('apple-silicon').resolver.requireTranscription(),
    ).rejects.toThrow('CPU/GPU');
  });
});
