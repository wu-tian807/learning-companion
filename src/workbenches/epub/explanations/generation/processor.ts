import type { AttachmentServiceApi } from '../../../../main/attachments/attachment-service';
import { AppError } from '../../../../main/errors/app-error';
import type {
  GenerationTaskProcessContext,
  GenerationTaskProcessor,
} from '../../../../main/generation/contracts/task-definition';
import type { JsonValue } from '../../../../shared/workbench/protocol';
import {
  EPUB_EXPLANATION_ATTACHMENT_TYPE,
  EPUB_EXPLANATION_ATTACHMENT_VERSION,
  isEpubCfiRangeTarget,
  isEpubExplanationMetadata,
} from '../shared';
import type { EpubExplanationInstruction } from './instruction';

export type EpubExplanationTaskResult = JsonValue & {
  readonly attachmentId: string;
};

const MAX_ANSWER_LENGTH = 64_000;

export class EpubExplanationProcessor
  implements
    GenerationTaskProcessor<
      EpubExplanationInstruction,
      EpubExplanationTaskResult
    >
{
  constructor(private readonly attachments: AttachmentServiceApi) {}

  async process(
    context: GenerationTaskProcessContext<EpubExplanationInstruction>,
  ): Promise<EpubExplanationTaskResult> {
    context.reportStatus('正在解释选中的文字…');
    const result = await context.agent.call({
      callKey: 'explain',
      purpose: 'generation',
      userMessage: context.defaultUserMessage,
      assistantEvents: 'none',
    });
    context.signal?.throwIfAborted();

    const answer = result.assistantOutput?.trim();
    if (!answer || answer.length > MAX_ANSWER_LENGTH) {
      throw new AppError('GENERATION_OUTPUT_INVALID', {
        cause: new Error('EPUB 解释最终回答为空或长度超出限制'),
      });
    }

    const existing = (
      await this.attachments.listByAsset(
        context.projectId,
        context.instruction.assetId,
      )
    ).find(
      (attachment) =>
        attachment.typeId === EPUB_EXPLANATION_ATTACHMENT_TYPE &&
        attachment.typeVersion === EPUB_EXPLANATION_ATTACHMENT_VERSION &&
        isEpubCfiRangeTarget(attachment.target) &&
        attachment.target.anchorType ===
          context.instruction.target.anchorType &&
        attachment.target.anchorVersion ===
          context.instruction.target.anchorVersion &&
        attachment.target.anchorPayload.cfiRange ===
          context.instruction.target.anchorPayload.cfiRange,
    );

    if (existing) {
      if (
        !isEpubExplanationMetadata(existing.metadata) ||
        existing.content?.mediaType !== 'text/markdown'
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      return Object.freeze({ attachmentId: existing.id });
    }

    context.signal?.throwIfAborted();
    const attachment = await this.attachments.createWithContent({
      projectId: context.projectId,
      assetId: context.instruction.assetId,
      typeId: EPUB_EXPLANATION_ATTACHMENT_TYPE,
      typeVersion: EPUB_EXPLANATION_ATTACHMENT_VERSION,
      target: context.instruction.target,
      metadata: {
        format: 'learning-companion/epub-explanation',
        version: 1,
      },
      content: {
        fileName: 'answer.md',
        mediaType: 'text/markdown',
        data: `${answer}\n`,
      },
    });

    return Object.freeze({ attachmentId: attachment.id });
  }
}
