import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { CachedSubtitleTrackReader } from '../../media-subtitles/cached-subtitle-track-reader';
import { MediaSubtitleRuntimeResolver } from '../../media-subtitles/external-libraries/media-subtitle-runtime';
import { VideoConversationContextProvider } from '../conversation/video-conversation-context-provider';
import {
  registerVideoExplanationHandlers,
  removeVideoExplanationHandlers,
} from './ipc';
import {
  VIDEO_EXPLANATION_ATTACHMENT_TYPE,
  VIDEO_EXPLANATION_ATTACHMENT_VERSION,
  isVideoExplanationMetadata,
} from './shared';
import { VideoExplanationService } from './video-explanation-service';

export const videoExplanationMainFeature = Object.freeze({
  id: 'builtin.video.frame-conversation',
  registerAttachmentTypes({ attachments }): void {
    attachments.register({
      typeId: VIDEO_EXPLANATION_ATTACHMENT_TYPE,
      version: VIDEO_EXPLANATION_ATTACHMENT_VERSION,
      isMetadata: isVideoExplanationMetadata,
    });
  },
  registerGeneration({
    conversationContexts,
    assets,
    artifacts,
    attachments,
    externalLibraries,
    projects,
  }): void {
    conversationContexts.register(
      new VideoConversationContextProvider(
        assets,
        attachments,
        new MediaSubtitleRuntimeResolver(externalLibraries),
        projects,
        new CachedSubtitleTrackReader(artifacts),
      ),
    );
  },
  start({ attachments, generationTasks, assets }) {
    const service = new VideoExplanationService(
      attachments,
      generationTasks,
      assets,
    );
    try {
      registerVideoExplanationHandlers(service);
    } catch (error) {
      removeVideoExplanationHandlers();
      service.dispose();
      throw error;
    }
    let disposed = false;
    return Object.freeze({
      dispose(): void {
        if (disposed) return;
        disposed = true;
        removeVideoExplanationHandlers();
        service.dispose();
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
