import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { CachedSubtitleTrackReader } from '../../media-subtitles/cached-subtitle-track-reader';
import { MediaSubtitleRuntimeResolver } from '../../media-subtitles/external-libraries/media-subtitle-runtime';
import {
  VIDEO_EXPLANATION_ATTACHMENT_TYPE,
  VIDEO_EXPLANATION_ATTACHMENT_VERSION,
  isVideoExplanationMetadata,
} from '../explanations/shared';
import {
  registerVideoExplanationHandlers,
  removeVideoExplanationHandlers,
} from '../explanations/ipc';
import { VideoExplanationService } from '../explanations/video-explanation-service';
import {
  VIDEO_FRAME_REGION_ANCHOR_TYPE,
  VIDEO_FRAME_REGION_ANCHOR_VERSION,
  isVideoFrameRegionAnchorV1,
} from '../shared';
import { VideoConversationContextProvider } from './video-conversation-context-provider';

export const videoConversationMainFeature = Object.freeze({
  id: 'builtin.video.frame-conversation',
  registerAttachmentTypes({ attachments, anchors }): void {
    anchors.register({
      anchorType: VIDEO_FRAME_REGION_ANCHOR_TYPE,
      version: VIDEO_FRAME_REGION_ANCHOR_VERSION,
      isPayload: isVideoFrameRegionAnchorV1,
    });
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
  start({ attachments, attachmentFiles, generationTasks, assets }) {
    const service = new VideoExplanationService(
      attachments,
      attachmentFiles,
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
