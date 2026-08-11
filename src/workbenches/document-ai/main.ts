import type { MainWorkbenchFeatureDefinition } from '../catalog/main-workbench-features';
import { createDocumentQuestionTaskDefinitionV1 } from './generation/document-question-task-definition';
import { registerDocumentAiHandlers, removeDocumentAiHandlers } from './ipc';
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
  start({ generationTasks }) {
    registerDocumentAiHandlers(generationTasks);
    return Object.freeze({ dispose: removeDocumentAiHandlers });
  },
} satisfies MainWorkbenchFeatureDefinition);
