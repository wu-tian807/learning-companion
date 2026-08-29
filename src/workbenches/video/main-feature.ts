import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import {
  mediaDubbingProducer,
  mediaDubbingProgress,
  resolveMediaDubbingRuntime,
} from '../media-dubbing/main-feature';
import { MediaDubbingService } from '../media-dubbing/media-dubbing-service';
import { MediaSubtitleRuntimeResolver } from '../media-subtitles/external-libraries/media-subtitle-runtime';
import { MediaSubtitleService } from '../media-subtitles/media-subtitle-service';
import { mediaSubtitleSourceTaskQueue } from '../media-subtitles/source-task-queue';
import { mediaSubtitleTranslationRuntime } from '../media-subtitles/translation-runtime';
import { videoExplanationMainFeature } from './explanations/main';
import { VideoWorkbenchProvider } from './main';
import { videoWorkbenchManifest } from './shared';

export const videoMainContribution = composeMainWorkbenchContribution(
  videoWorkbenchManifest,
  (context) => {
    const mediaRuntime = new MediaSubtitleRuntimeResolver(
      context.externalLibraryService,
    );
    const subtitles = new MediaSubtitleService(
      context.assetService,
      context.projectLookup,
      context.artifactService,
      mediaRuntime,
      mediaSubtitleSourceTaskQueue,
      context.generationTasks,
      mediaSubtitleTranslationRuntime.progress,
      videoWorkbenchManifest.supportedMediaTypes,
    );
    const dubbing = new MediaDubbingService(
      context.assetService,
      context.projectLookup,
      context.artifactService,
      subtitles,
      mediaDubbingProducer,
      mediaRuntime,
      resolveMediaDubbingRuntime(context.externalLibraryService),
      mediaDubbingProgress,
    );

    return new VideoWorkbenchProvider(
      context.contentResourceService,
      context.stateDatabase,
      {
        subtitles,
        dubbing,
        events: context.workbenchEvents,
      },
    );
  },
  [videoExplanationMainFeature],
);
