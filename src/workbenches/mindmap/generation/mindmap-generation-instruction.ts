import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  createTextAgentUserMessage,
  type AgentUserMessage,
} from '../../../main/generation/contracts/agent-message';
import {
  GenerationInstruction,
  type GenerationInstructionFactory,
} from '../../../main/generation/contracts/generation-instruction';
import {
  generationValidationFailure,
  generationValidationSuccess,
} from '../../../main/generation/contracts/generation-validation';

export const MIND_MAP_GENERATION_INSTRUCTION_FORMAT =
  'learning-companion/mindmap-generation-instruction';
export const MIND_MAP_GENERATION_INSTRUCTION_VERSION = 1;

export type MindMapGenerationInstructionSnapshot = JsonValue & {
  readonly format: typeof MIND_MAP_GENERATION_INSTRUCTION_FORMAT;
  readonly version: typeof MIND_MAP_GENERATION_INSTRUCTION_VERSION;
  readonly additionalInstructions?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class MindMapGenerationInstruction extends GenerationInstruction<MindMapGenerationInstructionSnapshot> {
  readonly additionalInstructions?: string;

  constructor(input: { readonly additionalInstructions?: string } = {}) {
    super();
    const normalized = input.additionalInstructions?.trim();
    this.additionalInstructions = normalized || undefined;
  }

  toSnapshot(): MindMapGenerationInstructionSnapshot {
    return Object.freeze({
      format: MIND_MAP_GENERATION_INSTRUCTION_FORMAT,
      version: MIND_MAP_GENERATION_INSTRUCTION_VERSION,
      ...(this.additionalInstructions
        ? { additionalInstructions: this.additionalInstructions }
        : {}),
    });
  }

  toUserMessage(): AgentUserMessage {
    return createTextAgentUserMessage(
      [
        '请根据提供的参考资料生成一份完整、层次清晰的思维导图。',
        this.additionalInstructions
          ? `补充要求：\n${this.additionalInstructions}`
          : undefined,
      ]
        .filter((part): part is string => part !== undefined)
        .join('\n\n'),
    );
  }
}

export const mindMapGenerationInstructionFactory: GenerationInstructionFactory<MindMapGenerationInstruction> =
  Object.freeze({
    parse(input: JsonValue) {
      if (
        !isRecord(input) ||
        input.format !== MIND_MAP_GENERATION_INSTRUCTION_FORMAT ||
        input.version !== MIND_MAP_GENERATION_INSTRUCTION_VERSION ||
        (input.additionalInstructions !== undefined &&
          typeof input.additionalInstructions !== 'string')
      ) {
        return generationValidationFailure([
          {
            path: 'instruction',
            message: 'Mind Map generation instruction 数据无效',
          },
        ]);
      }

      return generationValidationSuccess(
        new MindMapGenerationInstruction({
          ...(input.additionalInstructions === undefined
            ? {}
            : { additionalInstructions: input.additionalInstructions }),
        }),
      );
    },
  });
