import type { MainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { MediaSubtitleRuntimeResolver } from '../media-subtitles/external-libraries/media-subtitle-runtime';
import { VideoWorkbenchProvider } from './main';
import { videoWorkbenchManifest } from './shared';
import { VideoSubtitleService } from './subtitles/video-subtitle-service';

export const videoMainContribution = Object.freeze({
  id: videoWorkbenchManifest.id,
  manifest: videoWorkbenchManifest,
  createProvider(context) {
    const subtitles = new VideoSubtitleService(
      context.assetService,
      context.projectLookup,
      context.artifactService,
      context.artifactRegistry,
      new MediaSubtitleRuntimeResolver(context.externalLibraryService),
    );

    return new VideoWorkbenchProvider(
      context.contentResourceService,
      context.stateDatabase,
      {
        subtitles,
        events: context.workbenchEvents,
      },
    );
  },
} satisfies MainWorkbenchContribution);
