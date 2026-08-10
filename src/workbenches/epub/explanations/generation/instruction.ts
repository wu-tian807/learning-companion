import {
  createTextAgentUserMessage,
  type AgentUserMessage,
} from '../../../../main/generation/contracts/agent-message';
import {
  GenerationInstruction,
  type GenerationInstructionFactory,
} from '../../../../main/generation/contracts/generation-instruction';
import {
  generationValidationFailure,
  generationValidationSuccess,
} from '../../../../main/generation/contracts/generation-validation';
import type { JsonValue } from '../../../../shared/workbench/protocol';
import {
  EPUB_EXPLANATION_INSTRUCTION_FORMAT,
  EPUB_EXPLANATION_INSTRUCTION_VERSION,
} from '../shared';

export type EpubExplanationInstructionSnapshot = JsonValue & {
  readonly format: typeof EPUB_EXPLANATION_INSTRUCTION_FORMAT;
  readonly version: typeof EPUB_EXPLANATION_INSTRUCTION_VERSION;
  readonly attachmentId: string;
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class EpubExplanationInstruction extends GenerationInstruction<EpubExplanationInstructionSnapshot> {
  readonly attachmentId: string;
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;

  constructor(input: {
    readonly attachmentId: string;
    readonly exact: string;
    readonly prefix: string;
    readonly suffix: string;
  }) {
    super();
    this.attachmentId = input.attachmentId.trim();
    this.exact = input.exact.trim();
    this.prefix = input.prefix;
    this.suffix = input.suffix;
  }

  toSnapshot(): EpubExplanationInstructionSnapshot {
    return Object.freeze({
      format: EPUB_EXPLANATION_INSTRUCTION_FORMAT,
      version: EPUB_EXPLANATION_INSTRUCTION_VERSION,
      attachmentId: this.attachmentId,
      exact: this.exact,
      prefix: this.prefix,
      suffix: this.suffix,
    });
  }

  toUserMessage(): AgentUserMessage {
    return createTextAgentUserMessage(`请解释下面选中的文字，使普通读者能够理解。

要求：
1. 先用通俗语言说明它在表达什么。
2. 必要时解释其中的概念、术语或隐含关系。
3. 结合附近文字理解语境。
4. 不确定的内容要明确说明，不要编造背景。
5. 回答简洁，避免重复原文。

<context-before>
${this.prefix || '（无）'}
</context-before>

<selection>
${this.exact}
</selection>

<context-after>
${this.suffix || '（无）'}
</context-after>`);
  }
}

export const epubExplanationInstructionFactory: GenerationInstructionFactory<EpubExplanationInstruction> =
  Object.freeze({
    parse(input: JsonValue) {
      if (
        !isRecord(input) ||
        input.format !== EPUB_EXPLANATION_INSTRUCTION_FORMAT ||
        input.version !== EPUB_EXPLANATION_INSTRUCTION_VERSION ||
        typeof input.attachmentId !== 'string' ||
        input.attachmentId.trim().length === 0 ||
        typeof input.exact !== 'string' ||
        input.exact.trim().length === 0 ||
        input.exact.length > 16_384 ||
        typeof input.prefix !== 'string' ||
        input.prefix.length > 256 ||
        typeof input.suffix !== 'string' ||
        input.suffix.length > 256
      ) {
        return generationValidationFailure([
          { path: 'instruction', message: 'EPUB 解释任务数据无效' },
        ]);
      }

      return generationValidationSuccess(
        new EpubExplanationInstruction({
          attachmentId: input.attachmentId,
          exact: input.exact,
          prefix: input.prefix,
          suffix: input.suffix,
        }),
      );
    },
  });
