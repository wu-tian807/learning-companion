import type { AttachmentContentFile } from '../../../../main/attachments/attachment-content-file';
import type { AttachmentServiceApi } from '../../../../main/attachments/attachment-service';
import { AppError } from '../../../../main/errors/app-error';
import type {
  GenerationTaskProcessContext,
  GenerationTaskProcessor,
} from '../../../../main/generation/contracts/task-definition';
import type { JsonValue } from '../../../../shared/workbench/protocol';
import { isEpubExplanationMetadata } from '../shared';
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
  constructor(
    private readonly attachments: AttachmentServiceApi,
    private readonly contentFiles: AttachmentContentFile,
  ) {}

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

    const attachment = await this.attachments.get(
      context.instruction.attachmentId,
    );
    const currentMetadata = attachment?.metadata;
    if (
      !attachment ||
      attachment.projectId !== context.projectId ||
      !isEpubExplanationMetadata(currentMetadata) ||
      currentMetadata.status !== 'pending' ||
      currentMetadata.taskId !== context.taskId
    ) {
      throw new AppError('OPERATION_SUPERSEDED');
    }

    let contentWritten = false;
    try {
      const content = await this.contentFiles.write({
        projectId: attachment.projectId,
        attachmentId: attachment.id,
        fileName: 'answer.md',
        mediaType: 'text/markdown',
        content: `${answer}\n`,
      });
      contentWritten = true;
      context.signal?.throwIfAborted();
      await this.attachments.update({
        projectId: attachment.projectId,
        attachmentId: attachment.id,
        metadata: {
          format: 'learning-companion/epub-explanation',
          version: 1,
          status: 'completed',
          taskId: context.taskId,
          failureMessage: null,
        },
        content,
      });
    } catch (error) {
      if (contentWritten) {
        await this.contentFiles
          .removeAttachment(attachment.projectId, attachment.id)
          .catch((cleanupError: unknown) => {
            console.error('回滚 EPUB 解释 Attachment 内容失败', cleanupError);
          });
      }
      throw error;
    }

    return Object.freeze({ attachmentId: attachment.id });
  }
}
