import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AttachmentFileManager } from '../../../main/attachments/attachment-file-manager';
import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import type {
  GenerationTaskProcessContext,
  GenerationTaskProcessor,
} from '../../../main/generation/contracts/task-definition';
import type { JsonValue } from '../../../shared/workbench/protocol';
import type { EpubExplanationInstruction } from './epub-explanation-instruction';
import { EPUB_EXPLANATION_OUTPUT_RELATIVE_PATH } from './epub-explanation-task-definition';

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
    private readonly files: AttachmentFileManager,
  ) {}

  async process(
    context: GenerationTaskProcessContext<EpubExplanationInstruction>,
  ): Promise<EpubExplanationTaskResult> {
    context.reportStatus('正在解释选中的文字…');
    await context.agent.call({
      callKey: 'explain',
      purpose: 'generation',
      userMessage: context.defaultUserMessage,
    });
    context.signal?.throwIfAborted();

    const answer = (
      await readFile(
        join(
          context.workspaces.primary.path,
          ...EPUB_EXPLANATION_OUTPUT_RELATIVE_PATH.split('/'),
        ),
        'utf8',
      )
    ).trim();

    if (answer.length === 0 || answer.length > MAX_ANSWER_LENGTH) {
      throw new Error('EPUB 解释回答为空或长度超出限制');
    }

    const attachment = await this.attachments.get(
      context.instruction.attachmentId,
    );

    if (!attachment || attachment.projectId !== context.projectId) {
      throw new Error('EPUB 解释附件不存在或项目上下文已改变');
    }

    const content = await this.files.writeMarkdown(
      attachment.projectId,
      attachment.id,
      answer,
    );
    await this.attachments.update({
      ...attachment,
      metadata: {
        ...(attachment.metadata as Record<string, JsonValue>),
        status: 'completed',
        failureMessage: null,
      },
      content,
      updatedTime: Math.max(Date.now(), attachment.updatedTime),
    });

    return Object.freeze({ attachmentId: attachment.id });
  }
}
