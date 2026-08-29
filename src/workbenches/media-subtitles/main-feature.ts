import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import { createSubtitleTranslationTaskDefinition } from './generation/subtitle-translation-task-definition';
import {
  createMediaSubtitleSuiteDefinition,
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
} from './external-libraries/definitions';
import { MediaSubtitleRuntimeResolver } from './external-libraries/media-subtitle-runtime';
import { MediaSubtitleTranscriptionProducer } from './transcription-producer';
import {
  MediaSubtitleTranslationProducer,
  SubtitleTranslationProgressHub,
} from './translation-producer';

export const mediaSubtitleTranslationProducer =
  new MediaSubtitleTranslationProducer();
export const mediaSubtitleTranslationProgress =
  new SubtitleTranslationProgressHub();

export const mediaSubtitlesMainFeature = Object.freeze({
  id: 'builtin.media-subtitles',
  registerExternalLibraries({ libraries, hardware }): void {
    libraries.register(
      createMediaSubtitleSuiteDefinition(
        hardware.nvidiaGpuAvailable
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
    artifacts.register(mediaSubtitleTranslationProducer);
  },
  registerGeneration({ definitions, assets, artifacts, projects }): void {
    definitions.register(
      createSubtitleTranslationTaskDefinition({
        assets,
        artifacts,
        projects,
        producer: mediaSubtitleTranslationProducer,
        progress: mediaSubtitleTranslationProgress,
      }),
    );
  },
} satisfies MainWorkbenchFeatureContribution);
