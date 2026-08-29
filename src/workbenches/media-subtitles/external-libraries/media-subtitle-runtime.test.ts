import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ExternalLibraryServiceApi } from '../../../main/external-libraries/external-library-service';
import {
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
  MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
} from './definitions';
import { MediaSubtitleRuntimeResolver } from './media-subtitle-runtime';

function createResolver(
  variantId:
    | typeof MEDIA_SUBTITLE_CPU_VARIANT_ID
    | typeof MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
) {
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
  it('resolves the NVIDIA decoder and transcription engine', async () => {
    const { resolver, requireRuntime } = createResolver('nvidia');

    const decoder = await resolver.requireMediaDecoder();
    const transcription = await resolver.requireTranscription();

    expect(requireRuntime).toHaveBeenCalledTimes(2);
    expect(requireRuntime).toHaveBeenCalledWith(
      MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
    );
    expect(decoder.ffmpegPath).toContain('ffmpeg.exe');
    expect(decoder.ffprobePath).toContain('ffprobe.exe');
    expect(transcription.kind).toBe('whisper');
    expect(transcription.modelPath).toContain(
      join('whisper', 'models', 'ggml-large-v3-turbo-q5_0.bin'),
    );
  });

  it('resolves SenseVoice as the only CPU transcription engine', async () => {
    const { resolver } = createResolver('cpu');

    const transcription = await resolver.requireTranscription();

    expect(transcription.kind).toBe('sensevoice');
    expect(transcription.modelPath).toContain(
      join('sensevoice', 'models', 'sensevoice-small-q8.gguf'),
    );
    expect(transcription.vadModelPath).toContain('fsmn-vad.gguf');
  });
});
