import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ExternalLibraryServiceApi } from '../../../main/external-libraries/external-library-service';
import {
  MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID,
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
  MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
  type MediaSubtitleVariantId,
} from './definitions';
import { MediaSubtitleRuntimeResolver } from './media-subtitle-runtime';

function createResolver(variantId: MediaSubtitleVariantId) {
  const runtimeDirectory = join(
    'C:\\externalLib',
    MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
    'runtime',
  );
  const requireRuntime = vi.fn(async (libraryId: string) => ({
    libraryId,
    variantId,
    runtimeDirectory,
  }));
  const externalLibraries = {
    requireRuntime,
  } as unknown as ExternalLibraryServiceApi;

  return {
    requireRuntime,
    resolver: new MediaSubtitleRuntimeResolver(externalLibraries),
  };
}

describe('MediaSubtitleRuntimeResolver', () => {
  it('resolves the NVIDIA-only MOSS CUDA runtime', async () => {
    const { resolver, requireRuntime } = createResolver(
      MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
    );

    const decoder = await resolver.requireMediaDecoder();
    const transcription = await resolver.requireTranscription();

    expect(requireRuntime).toHaveBeenCalledTimes(2);
    expect(requireRuntime).toHaveBeenCalledWith(
      MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
    );
    expect(decoder.ffmpegPath).toContain('ffmpeg.exe');
    expect(decoder.ffprobePath).toContain('ffprobe.exe');
    expect(transcription).toMatchObject({
      kind: 'moss',
      profile: 'nvidia',
      backend: 'cuda',
    });
    if (transcription.kind !== 'moss') throw new Error('expected MOSS');
    expect(transcription.modelPath).toContain(
      join('moss', 'models', 'MOSS-Transcribe-Diarize-Q5_K_M.gguf'),
    );
    expect(transcription.nativeLibraryPath).toContain('transcribe.dll');
    expect(transcription.environment.TRANSCRIBE_LIBRARY).toBe(
      transcription.nativeLibraryPath,
    );
    expect(transcription.environment.PATH).toContain(
      join('moss', 'cuda-cublas', 'nvidia', 'cublas', 'bin'),
    );
    expect(transcription.environment.PATH).toContain(
      join('moss', 'cuda-core', 'nvidia', 'cuda_runtime', 'bin'),
    );
  });

  it('resolves SenseVoice and FastClustering only for the CPU variant', async () => {
    const { resolver } = createResolver(MEDIA_SUBTITLE_CPU_VARIANT_ID);

    const transcription = await resolver.requireTranscription();

    expect(transcription.kind).toBe('sensevoice');
    if (transcription.kind !== 'sensevoice') {
      throw new Error('expected SenseVoice');
    }
    expect(transcription.modelPath).toContain(
      join('sensevoice', 'models', 'sensevoice-small-q8.gguf'),
    );
    expect(transcription.vadModelPath).toContain('fsmn-vad.gguf');
    expect(transcription.speakerDiarizationExecutablePath).toContain(
      'sherpa-onnx-offline-speaker-diarization.exe',
    );
    expect(transcription.speakerEmbeddingModelPath).toContain(
      '3dspeaker-campplus-zh-en.onnx',
    );
  });

  it('resolves the Apple-Silicon-only MOSS Metal runtime', async () => {
    const { resolver } = createResolver(
      MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID,
    );

    const decoder = await resolver.requireMediaDecoder();
    const transcription = await resolver.requireTranscription();

    expect(decoder.ffmpegPath).toMatch(/[\\/]ffmpeg$/u);
    expect(decoder.ffprobePath).toMatch(/[\\/]ffprobe$/u);
    expect(transcription).toMatchObject({
      kind: 'moss',
      profile: 'apple-silicon',
      backend: 'metal',
    });
    if (transcription.kind !== 'moss') throw new Error('expected MOSS');
    expect(transcription.nativeLibraryPath).toContain(
      'libtranscribe.dylib',
    );
  });
});
