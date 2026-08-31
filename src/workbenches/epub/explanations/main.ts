import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import {
  EPUB_CFI_RANGE_ANCHOR_TYPE,
  EPUB_CFI_RANGE_ANCHOR_VERSION,
  isEpubCfiRangeAnchorV1,
} from '../shared';
import { EpubExplanationService } from './epub-explanation-service';
import { EpubConversationContextProvider } from './generation/epub-conversation-context-provider';
import {
  registerEpubExplanationHandlers,
  removeEpubExplanationHandlers,
} from './ipc';
import {
  EPUB_EXPLANATION_ATTACHMENT_TYPE,
  EPUB_EXPLANATION_ATTACHMENT_VERSION,
  isEpubExplanationMetadata,
} from './shared';

export const epubExplanationMainFeature = Object.freeze({
  id: 'builtin.epub.explanations',
  registerAttachmentTypes({ attachments, anchors }): void {
    anchors.register({
      anchorType: EPUB_CFI_RANGE_ANCHOR_TYPE,
      version: EPUB_CFI_RANGE_ANCHOR_VERSION,
      isPayload: isEpubCfiRangeAnchorV1,
    });
    attachments.register({
      typeId: EPUB_EXPLANATION_ATTACHMENT_TYPE,
      version: EPUB_EXPLANATION_ATTACHMENT_VERSION,
      isMetadata: isEpubExplanationMetadata,
    });
  },
  registerGeneration({ conversationContexts, attachments }): void {
    conversationContexts.register(
      new EpubConversationContextProvider(attachments),
    );
  },
  start({ attachments, generationTasks, assets }) {
    const service = new EpubExplanationService(
      attachments,
      generationTasks,
      assets,
    );

    try {
      registerEpubExplanationHandlers(service);
    } catch (error) {
      removeEpubExplanationHandlers();
      service.dispose();
      throw error;
    }

    let disposed = false;
    return Object.freeze({
      dispose(): void {
        if (disposed) {
          return;
        }
        disposed = true;
        removeEpubExplanationHandlers();
        service.dispose();
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
