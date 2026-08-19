import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import {
  IMAGE_REGION_ANCHOR_TYPE,
  IMAGE_REGION_ANCHOR_VERSION,
  isImageRegionAnchorV1,
} from '../shared';
import { ImageExplanationService } from './image-explanation-service';
import { ImageExplanationProcessor } from './generation/processor';
import { createImageExplanationTaskDefinitionV1 } from './generation/task-definition';
import { registerImageExplanationHandlers, removeImageExplanationHandlers } from './ipc';
import {
  IMAGE_EXPLANATION_ATTACHMENT_TYPE,
  IMAGE_EXPLANATION_ATTACHMENT_VERSION,
  isImageExplanationMetadata,
} from './shared';

export const imageExplanationMainFeature = Object.freeze({
  id: 'builtin.image.explanations',
  registerAttachmentTypes({ attachments, anchors }): void {
    anchors.register({
      anchorType: IMAGE_REGION_ANCHOR_TYPE,
      version: IMAGE_REGION_ANCHOR_VERSION,
      isPayload: isImageRegionAnchorV1,
    });
    attachments.register({
      typeId: IMAGE_EXPLANATION_ATTACHMENT_TYPE,
      version: IMAGE_EXPLANATION_ATTACHMENT_VERSION,
      isMetadata: isImageExplanationMetadata,
    });
  },
  registerGenerationTaskDefinitions({ definitions, attachments }): void {
    definitions.register(createImageExplanationTaskDefinitionV1(new ImageExplanationProcessor(attachments)));
  },
  start({ attachments, attachmentFiles, generationTasks, assets }) {
    const service = new ImageExplanationService(attachments, attachmentFiles, generationTasks, assets);
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
