import type { MainWorkbenchContribution } from '../../catalog/register-main-workbenches';
import {
  EPUB_CFI_RANGE_ANCHOR_TYPE,
  EPUB_CFI_RANGE_ANCHOR_VERSION,
  isEpubCfiRangeAnchorV1,
} from '../shared';
import { EpubExplanationService } from './epub-explanation-service';
import { EpubExplanationProcessor } from './generation/processor';
import { createEpubExplanationTaskDefinitionV1 } from './generation/task-definition';
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
  registerGenerationTaskDefinitions({ definitions, attachments }): void {
    definitions.register(
      createEpubExplanationTaskDefinitionV1(
        new EpubExplanationProcessor(attachments),
      ),
    );
  },
  start({ attachments, attachmentFiles, generationTasks, assets }) {
    const service = new EpubExplanationService(
      attachments,
      attachmentFiles,
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
} satisfies MainWorkbenchContribution);
