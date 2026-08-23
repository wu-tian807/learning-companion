import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { CachedSubtitleTrackReader } from '../../media-subtitles/cached-subtitle-track-reader';
import { MediaSubtitleRuntimeResolver } from '../../media-subtitles/external-libraries/media-subtitle-runtime';
import { VideoConversationContextProvider } from './video-conversation-context-provider';

export const videoConversationMainFeature = Object.freeze({
  id: 'builtin.video.frame-conversation',
  registerGeneration({
    conversationContexts,
    assets,
    artifacts,
    externalLibraries,
    projects,
  }): void {
    conversationContexts.register(
      new VideoConversationContextProvider(
        assets,
        new MediaSubtitleRuntimeResolver(externalLibraries),
        projects,
        new CachedSubtitleTrackReader(artifacts),
      ),
    );
  },
} satisfies MainWorkbenchFeatureContribution);
