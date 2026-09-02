import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { ImageExplanationService } from './image-explanation-service';
import { ImageConversationContextProvider } from './generation/image-conversation-context-provider';
import {
  registerImageExplanationHandlers,
  removeImageExplanationHandlers,
} from './ipc';
import {
  IMAGE_EXPLANATION_ATTACHMENT_TYPE,
  IMAGE_EXPLANATION_ATTACHMENT_VERSION,
  isImageExplanationMetadata,
} from './shared';

export const imageExplanationMainFeature = Object.freeze({
  id: 'builtin.image.explanations',
  registerAttachmentTypes({ attachments }): void {
    attachments.register({
      typeId: IMAGE_EXPLANATION_ATTACHMENT_TYPE,
      version: IMAGE_EXPLANATION_ATTACHMENT_VERSION,
      isMetadata: isImageExplanationMetadata,
    });
  },
  registerGeneration({ conversationContexts, attachments }): void {
    conversationContexts.register(
      new ImageConversationContextProvider(attachments),
    );
  },
  start({ attachments, generationTasks, assets }) {
    const service = new ImageExplanationService(
      attachments,
      generationTasks,
      assets,
    );
    try {
      registerImageExplanationHandlers(service);
    } catch (error) {
      removeImageExplanationHandlers();
      service.dispose();
      throw error;
    }
    let disposed = false;
    return Object.freeze({
      dispose(): void {
        if (disposed) return;
        disposed = true;
        removeImageExplanationHandlers();
        service.dispose();
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
