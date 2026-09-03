import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import { DocumentConversationContextProvider } from './generation/document-conversation-context-provider';
import {
  AI_ANNOTATION_ATTACHMENT_TYPE,
  AI_ANNOTATION_ATTACHMENT_VERSION,
  isAiAnnotationMetadata,
} from './ai-annotation-attachment';

export const documentAiMainFeature = Object.freeze({
  id: 'builtin.document-ai',
  registerAttachmentTypes({ attachments }): void {
    attachments.register({
      typeId: AI_ANNOTATION_ATTACHMENT_TYPE,
      version: AI_ANNOTATION_ATTACHMENT_VERSION,
      isMetadata: isAiAnnotationMetadata,
    });
  },
  registerGeneration({ conversationContexts, assets }): void {
    conversationContexts.register(
      new DocumentConversationContextProvider(assets),
    );
  },
} satisfies MainWorkbenchFeatureContribution);
