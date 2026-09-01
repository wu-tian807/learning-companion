import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import { createSubtitleTranslationTaskDefinition } from './generation/subtitle-translation-task-definition';
import {
  createMediaSubtitleSuiteDefinition,
  MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID,
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
} from './external-libraries/definitions';
import { MediaSubtitleRuntimeResolver } from './external-libraries/media-subtitle-runtime';
import { mediaSubtitleSrtRuntime } from './srt-runtime';
import { MediaSubtitleTranscriptionProducer } from './transcription-producer';
import { mediaSubtitleTranslationRuntime } from './translation-runtime';

export const mediaSubtitlesMainFeature = Object.freeze({
  id: 'builtin.media-subtitles',
  registerExternalLibraries({ libraries, hardware }): void {
    libraries.register(
      createMediaSubtitleSuiteDefinition(
        hardware.appleSiliconAvailable
          ? MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID
          : hardware.nvidiaGpuAvailable
          ? MEDIA_SUBTITLE_NVIDIA_VARIANT_ID
          : MEDIA_SUBTITLE_CPU_VARIANT_ID,
      ),
    );
  },
  registerArtifactProducers({ artifacts, externalLibraries }): void {
    artifacts.register(
      new MediaSubtitleTranscriptionProducer(
        new MediaSubtitleRuntimeResolver(externalLibraries),
      ),
    );
    artifacts.register(mediaSubtitleTranslationRuntime.producer);
    artifacts.register(mediaSubtitleSrtRuntime.producer);
  },
  registerGeneration({ definitions, assets, artifacts, projects }): void {
    definitions.register(
      createSubtitleTranslationTaskDefinition({
        assets,
        artifacts,
        projects,
        producer: mediaSubtitleTranslationRuntime.producer,
        progress: mediaSubtitleTranslationRuntime.progress,
      }),
    );
  },
} satisfies MainWorkbenchFeatureContribution);
