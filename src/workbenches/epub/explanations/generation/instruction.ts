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
  isEpubCfiRangeTarget,
  type EpubCfiRangeTarget,
} from '../shared';

export type EpubExplanationInstructionSnapshot = JsonValue & {
  readonly format: typeof EPUB_EXPLANATION_INSTRUCTION_FORMAT;
  readonly version: typeof EPUB_EXPLANATION_INSTRUCTION_VERSION;
  readonly assetId: string;
  readonly target: JsonValue & EpubCfiRangeTarget;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class EpubExplanationInstruction extends GenerationInstruction<EpubExplanationInstructionSnapshot> {
  readonly assetId: string;
  readonly target: EpubCfiRangeTarget;

  constructor(input: {
    readonly assetId: string;
    readonly target: EpubCfiRangeTarget;
  }) {
    super();
    this.assetId = input.assetId.trim();
    this.target = input.target;
  }

  toSnapshot(): EpubExplanationInstructionSnapshot {
    const target = Object.freeze({
      scope: 'content' as const,
      anchorType: this.target.anchorType,
      anchorVersion: this.target.anchorVersion,
      anchorPayload: this.target.anchorPayload,
    }) as JsonValue & EpubCfiRangeTarget;
    return Object.freeze({
      format: EPUB_EXPLANATION_INSTRUCTION_FORMAT,
      version: EPUB_EXPLANATION_INSTRUCTION_VERSION,
      assetId: this.assetId,
      target,
    });
  }

  toUserMessage(): AgentUserMessage {
    const { exact, prefix, suffix } = this.target.anchorPayload.quote;
    return createTextAgentUserMessage(`请解释下面选中的文字，使普通读者能够理解。

要求：
1. 先用通俗语言说明它在表达什么。
2. 必要时解释其中的概念、术语或隐含关系。
3. 结合附近文字理解语境。
4. 不确定的内容要明确说明，不要编造背景。
5. 回答简洁，避免重复原文。

<context-before>
${prefix || '（无）'}
</context-before>

<selection>
${exact}
</selection>

<context-after>
${suffix || '（无）'}
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
        typeof input.assetId !== 'string' ||
        input.assetId.trim().length === 0 ||
        !isEpubCfiRangeTarget(input.target)
      ) {
        return generationValidationFailure([
          { path: 'instruction', message: 'EPUB 解释任务数据无效' },
        ]);
      }

      return generationValidationSuccess(
        new EpubExplanationInstruction({
          assetId: input.assetId,
          target: input.target,
        }),
      );
    },
  });
