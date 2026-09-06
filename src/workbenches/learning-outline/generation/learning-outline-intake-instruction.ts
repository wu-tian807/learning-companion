import { createTextAgentUserMessage, type AgentUserMessage } from '../../../main/generation/contracts/agent-message';
import {
  GenerationInstruction,
  type GenerationInstructionFactory,
} from '../../../main/generation/contracts/generation-instruction';
import {
  generationValidationFailure,
  generationValidationSuccess,
} from '../../../main/generation/contracts/generation-validation';
import {
  isJsonValue,
  type JsonValue,
} from '../../../shared/workbench/protocol';
import {
  LEARNING_OUTLINE_INTAKE_INSTRUCTION_FORMAT,
  LEARNING_OUTLINE_INTAKE_INSTRUCTION_VERSION,
} from '../shared';

const ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/u;
const MAX_QUESTION_LENGTH = 32_768;
const MAX_CONTEXT_BYTES = 64 * 1_024;

export type LearningOutlineIntakeInstructionSnapshot = JsonValue & {
  readonly format: typeof LEARNING_OUTLINE_INTAKE_INSTRUCTION_FORMAT;
  readonly version: typeof LEARNING_OUTLINE_INTAKE_INSTRUCTION_VERSION;
  readonly conversationId: string;
  readonly boundAssetId: string;
  readonly question: string;
  readonly assetId?: string;
  readonly context?: JsonValue;
  readonly contextSource?: JsonValue;
  readonly generateTitle?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedJson(value: unknown): value is JsonValue | undefined {
  return value === undefined || (
    isJsonValue(value) &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_CONTEXT_BYTES
  );
}

export class LearningOutlineIntakeInstruction extends GenerationInstruction<
  LearningOutlineIntakeInstructionSnapshot
> {
  readonly conversationId: string;
  readonly boundAssetId: string;
  readonly question: string;
  readonly assetId?: string;
  readonly context?: JsonValue;
  readonly contextSource?: JsonValue;
  readonly generateTitle: boolean;

  constructor(input: {
    readonly conversationId: string;
    readonly boundAssetId: string;
    readonly question: string;
    readonly assetId?: string;
    readonly context?: JsonValue;
    readonly contextSource?: JsonValue;
    readonly generateTitle?: boolean;
  }) {
    super();
    const conversationId = input.conversationId.trim();
    const boundAssetId = input.boundAssetId.trim();
    const assetId = input.assetId?.trim();
    const question = input.question.trim();
    if (
      !ID_PATTERN.test(conversationId) ||
      !ID_PATTERN.test(boundAssetId) ||
      (assetId !== undefined && !ID_PATTERN.test(assetId)) ||
      !question ||
      question.length > MAX_QUESTION_LENGTH ||
      !isBoundedJson(input.context) ||
      !isBoundedJson(input.contextSource)
    ) {
      throw new Error('Learning Outline intake instruction 数据无效');
    }
    this.conversationId = conversationId;
    this.boundAssetId = boundAssetId;
    this.question = question;
    this.assetId = assetId;
    this.context = input.context;
    this.contextSource = input.contextSource;
    this.generateTitle = input.generateTitle === true;
  }

  toSnapshot(): LearningOutlineIntakeInstructionSnapshot {
    return Object.freeze({
      format: LEARNING_OUTLINE_INTAKE_INSTRUCTION_FORMAT,
      version: LEARNING_OUTLINE_INTAKE_INSTRUCTION_VERSION,
      conversationId: this.conversationId,
      boundAssetId: this.boundAssetId,
      question: this.question,
      ...(this.assetId ? { assetId: this.assetId } : {}),
      ...(this.context === undefined ? {} : { context: this.context }),
      ...(this.contextSource === undefined
        ? {}
        : { contextSource: this.contextSource }),
      ...(this.generateTitle ? { generateTitle: true } : {}),
    }) as LearningOutlineIntakeInstructionSnapshot;
  }

  toUserMessage(): AgentUserMessage {
    return createTextAgentUserMessage(`用户问题：${this.question}`);
  }
}

export const learningOutlineIntakeInstructionFactory: GenerationInstructionFactory<LearningOutlineIntakeInstruction> =
  Object.freeze({
    parse(input: JsonValue) {
      if (
        !isRecord(input) ||
        input.format !== LEARNING_OUTLINE_INTAKE_INSTRUCTION_FORMAT ||
        input.version !== LEARNING_OUTLINE_INTAKE_INSTRUCTION_VERSION ||
        typeof input.conversationId !== 'string' ||
        typeof input.boundAssetId !== 'string' ||
        typeof input.question !== 'string' ||
        (input.assetId !== undefined && typeof input.assetId !== 'string') ||
        !isBoundedJson(input.context) ||
        !isBoundedJson(input.contextSource) ||
        (input.generateTitle !== undefined &&
          typeof input.generateTitle !== 'boolean')
      ) {
        return generationValidationFailure([
          {
            path: 'instruction',
            message: 'Learning Outline intake instruction 数据无效',
          },
        ]);
      }

      try {
        return generationValidationSuccess(
          new LearningOutlineIntakeInstruction({
            conversationId: input.conversationId,
            boundAssetId: input.boundAssetId,
            question: input.question,
            ...(input.assetId === undefined ? {} : { assetId: input.assetId }),
            ...(input.context === undefined ? {} : { context: input.context }),
            ...(input.contextSource === undefined
              ? {}
              : { contextSource: input.contextSource }),
            ...(input.generateTitle === true ? { generateTitle: true } : {}),
          }),
        );
      } catch {
        return generationValidationFailure([
          {
            path: 'instruction',
            message: 'Learning Outline intake instruction 数据无效',
          },
        ]);
      }
    },
  });
