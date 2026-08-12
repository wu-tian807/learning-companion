import type { MainWorkbenchContribution } from '../catalog/register-main-workbenches';
import { createDocumentQuestionTaskDefinitionV1 } from './generation/document-question-task-definition';
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
  registerGenerationTaskDefinitions({ definitions }): void {
    definitions.register(createDocumentQuestionTaskDefinitionV1());
  },
} satisfies MainWorkbenchContribution);
