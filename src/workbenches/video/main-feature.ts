import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { MediaSubtitleRuntimeResolver } from '../media-subtitles/external-libraries/media-subtitle-runtime';
import { mediaSubtitleTranslationRuntime } from '../media-subtitles/translation-runtime';
import { videoExplanationMainFeature } from './explanations/main';
import {
  videoDubbingMainFeature,
  videoDubbingProducer,
  videoDubbingProgress,
} from './dubbing/main-feature';
import { VoxCpm2DubbingRuntimeResolver } from './dubbing/external-libraries/voxcpm2-runtime';
import { VideoDubbingService } from './dubbing/video-dubbing-service';
import { VideoWorkbenchProvider } from './main';
import { videoWorkbenchManifest } from './shared';
import { VideoSubtitleService } from './subtitles/video-subtitle-service';

export const videoMainContribution = composeMainWorkbenchContribution(
  videoWorkbenchManifest,
  (context) => {
    const mediaRuntime = new MediaSubtitleRuntimeResolver(
      context.externalLibraryService,
    );
    const subtitles = new VideoSubtitleService(
      context.assetService,
      context.projectLookup,
      context.artifactService,
      mediaRuntime,
      context.generationTasks,
      mediaSubtitleTranslationRuntime.progress,
    );
    const dubbing = new VideoDubbingService(
      context.assetService,
      context.projectLookup,
      context.artifactService,
      subtitles,
      videoDubbingProducer,
      mediaRuntime,
      new VoxCpm2DubbingRuntimeResolver(context.externalLibraryService),
      videoDubbingProgress,
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
  [videoExplanationMainFeature, videoDubbingMainFeature],
);
