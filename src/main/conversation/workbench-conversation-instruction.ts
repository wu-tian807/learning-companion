import {
  createTextAgentUserMessage,
  type AgentUserMessage,
} from '../generation/contracts/agent-message';
import {
  GenerationInstruction,
  type GenerationInstructionFactory,
} from '../generation/contracts/generation-instruction';
import {
  generationValidationFailure,
  generationValidationSuccess,
} from '../generation/contracts/generation-validation';
import {
  WORKBENCH_CONVERSATION_INSTRUCTION_FORMAT,
  WORKBENCH_CONVERSATION_INSTRUCTION_VERSION,
} from '../../shared/workbench-conversation';
import { isJsonValue, type JsonValue } from '../../shared/workbench/protocol';

const ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/u;
const CONTEXT_PROVIDER_ID_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const MAX_QUESTION_LENGTH = 32_768;
const MAX_CONTEXT_BYTES = 64 * 1_024;

export type WorkbenchConversationInstructionSnapshot = JsonValue & {
  readonly format: typeof WORKBENCH_CONVERSATION_INSTRUCTION_FORMAT;
  readonly version: typeof WORKBENCH_CONVERSATION_INSTRUCTION_VERSION;
  readonly contextProviderId: string;
  readonly assetId: string;
  readonly conversationId: string;
  readonly question: string;
  readonly context?: JsonValue;
  readonly commitAnswer?: boolean;
  readonly generateTitle?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedContext(value: unknown): value is JsonValue | undefined {
  return (
    value === undefined ||
    (isJsonValue(value) &&
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
        MAX_CONTEXT_BYTES)
  );
}

export class WorkbenchConversationInstruction extends GenerationInstruction<WorkbenchConversationInstructionSnapshot> {
  readonly contextProviderId: string;
  readonly assetId: string;
  readonly conversationId: string;
  readonly question: string;
  readonly context?: JsonValue;
  readonly commitAnswer: boolean;
  readonly generateTitle: boolean;

  constructor(input: {
    readonly contextProviderId: string;
    readonly assetId: string;
    readonly conversationId: string;
    readonly question: string;
    readonly context?: JsonValue;
    readonly commitAnswer?: boolean;
    readonly generateTitle?: boolean;
  }) {
    super();
    const contextProviderId = input.contextProviderId.trim();
    const assetId = input.assetId.trim();
    const conversationId = input.conversationId.trim();
    const question = input.question.trim();

    if (
      !CONTEXT_PROVIDER_ID_PATTERN.test(contextProviderId) ||
      !ID_PATTERN.test(assetId) ||
      !ID_PATTERN.test(conversationId) ||
      question.length === 0 ||
      question.length > MAX_QUESTION_LENGTH ||
      !isBoundedContext(input.context)
    ) {
      throw new Error('Workbench Conversation instruction 数据无效');
    }

    this.contextProviderId = contextProviderId;
    this.assetId = assetId;
    this.conversationId = conversationId;
    this.question = question;
    this.context = input.context;
    this.commitAnswer = input.commitAnswer === true;
    this.generateTitle = input.generateTitle === true;
  }

  toSnapshot(): WorkbenchConversationInstructionSnapshot {
    return Object.freeze({
      format: WORKBENCH_CONVERSATION_INSTRUCTION_FORMAT,
      version: WORKBENCH_CONVERSATION_INSTRUCTION_VERSION,
      contextProviderId: this.contextProviderId,
      assetId: this.assetId,
      conversationId: this.conversationId,
      question: this.question,
      ...(this.context === undefined ? {} : { context: this.context }),
      ...(this.commitAnswer ? { commitAnswer: true } : {}),
      ...(this.generateTitle ? { generateTitle: true } : {}),
    }) as WorkbenchConversationInstructionSnapshot;
  }

  toUserMessage(): AgentUserMessage {
    return createTextAgentUserMessage(`用户问题：${this.question}`);
  }
}

export const workbenchConversationInstructionFactory: GenerationInstructionFactory<WorkbenchConversationInstruction> =
  Object.freeze({
    parse(input: JsonValue) {
      if (
        !isRecord(input) ||
        input.format !== WORKBENCH_CONVERSATION_INSTRUCTION_FORMAT ||
        input.version !== WORKBENCH_CONVERSATION_INSTRUCTION_VERSION ||
        typeof input.contextProviderId !== 'string' ||
        typeof input.assetId !== 'string' ||
        typeof input.conversationId !== 'string' ||
        typeof input.question !== 'string' ||
        !isBoundedContext(input.context) ||
        (input.commitAnswer !== undefined &&
          typeof input.commitAnswer !== 'boolean') ||
        (input.generateTitle !== undefined &&
          typeof input.generateTitle !== 'boolean')
      ) {
        return generationValidationFailure([
          {
            path: 'instruction',
            message: 'Workbench Conversation instruction 数据无效',
          },
        ]);
      }

      try {
        return generationValidationSuccess(
          new WorkbenchConversationInstruction({
            contextProviderId: input.contextProviderId,
            assetId: input.assetId,
            conversationId: input.conversationId,
            question: input.question,
            ...(input.context === undefined ? {} : { context: input.context }),
            ...(input.commitAnswer === true ? { commitAnswer: true } : {}),
            ...(input.generateTitle === true ? { generateTitle: true } : {}),
          }),
        );
      } catch {
        return generationValidationFailure([
          {
            path: 'instruction',
            message: 'Workbench Conversation instruction 数据无效',
          },
        ]);
      }
    },
  });
