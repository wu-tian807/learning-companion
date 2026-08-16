import type { AssetTarget } from '../../../shared/workbench/anchor';
import { cloneAssetTarget, isAssetTarget } from '../../../shared/workbench/anchor';
import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  DOCUMENT_QUESTION_INSTRUCTION_FORMAT,
  DOCUMENT_QUESTION_INSTRUCTION_VERSION,
} from '../../../shared/generation-definitions';
import {
  createTextAgentUserMessage,
  type AgentUserMessage,
} from '../../../main/generation/contracts/agent-message';
import {
  GenerationInstruction,
  type GenerationInstructionFactory,
  type PreparedInstructionContext,
} from '../../../main/generation/contracts/generation-instruction';
import {
  generationValidationFailure,
  generationValidationSuccess,
} from '../../../main/generation/contracts/generation-validation';

export type DocumentQuestionInstructionSnapshot = JsonValue & {
  readonly format: typeof DOCUMENT_QUESTION_INSTRUCTION_FORMAT;
  readonly version: typeof DOCUMENT_QUESTION_INSTRUCTION_VERSION;
  readonly question: string;
  readonly conversationId: string;
  readonly target: JsonValue;
  readonly selectedText?: string;
  readonly generateTitle?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DocumentQuestionInstruction extends GenerationInstruction<DocumentQuestionInstructionSnapshot> {
  readonly question: string;
  readonly conversationId: string;
  readonly target: AssetTarget;
  readonly selectedText?: string;
  readonly generateTitle: boolean;

  constructor(input: {
    readonly question: string;
    readonly conversationId: string;
    readonly target: AssetTarget;
    readonly selectedText?: string;
    readonly generateTitle?: boolean;
  }) {
    super();
    const question = input.question.trim();
    const selectedText = input.selectedText?.trim();
    const conversationId = input.conversationId.trim();

    if (!question || !/^[A-Za-z0-9._-]{1,128}$/u.test(conversationId)) {
      throw new Error('Document question cannot be empty');
    }

    this.question = question;
    this.conversationId = conversationId;
    this.target = cloneAssetTarget(input.target);
    this.selectedText = selectedText || undefined;
    this.generateTitle = input.generateTitle === true;
  }

  toSnapshot(): DocumentQuestionInstructionSnapshot {
    return Object.freeze({
      format: DOCUMENT_QUESTION_INSTRUCTION_FORMAT,
      version: DOCUMENT_QUESTION_INSTRUCTION_VERSION,
      question: this.question,
      conversationId: this.conversationId,
      target: this.target as unknown as JsonValue,
      ...(this.selectedText ? { selectedText: this.selectedText } : {}),
      ...(this.generateTitle ? { generateTitle: true } : {}),
    });
  }

  toUserMessage(context: PreparedInstructionContext): AgentUserMessage {
    const document = context.assetReferences['document']?.[0];

    if (!document) {
      throw new Error('Prepared document reference is missing');
    }

    return createTextAgentUserMessage(
      [
        `Question: ${this.question}`,
        `Document path: ${document.relativePath}`,
        `Document media type: ${document.materializedMediaType ?? document.mediaType}`,
        `Target anchor: ${JSON.stringify(this.target)}`,
        this.selectedText
          ? `Selected text:\n${this.selectedText}`
          : 'No reliable text selection was supplied. Inspect the referenced document and the target page/region with the document tools.',
        'Answer in clear Chinese unless the user explicitly requests another language.',
        ...(this.generateTitle
          ? ['This is the first question in this conversation. Start the response with exactly one line in the form <conversation-title>简短主题</conversation-title>. The title must summarize the subject, not repeat the question, and contain at most 16 Chinese characters. Put the normal answer after that line.']
          : []),
      ].join('\n\n'),
    );
  }
}

export const documentQuestionInstructionFactory: GenerationInstructionFactory<DocumentQuestionInstruction> =
  Object.freeze({
    parse(input: JsonValue) {
      if (
        !isRecord(input) ||
        input.format !== DOCUMENT_QUESTION_INSTRUCTION_FORMAT ||
        input.version !== DOCUMENT_QUESTION_INSTRUCTION_VERSION ||
        typeof input.question !== 'string' ||
        typeof input.conversationId !== 'string' ||
        !isAssetTarget(input.target) ||
        (input.selectedText !== undefined && typeof input.selectedText !== 'string')
        || (input.generateTitle !== undefined && typeof input.generateTitle !== 'boolean')
      ) {
        return generationValidationFailure([
          { path: 'instruction', message: 'Document question instruction is invalid' },
        ]);
      }

      try {
        return generationValidationSuccess(
          new DocumentQuestionInstruction({
            question: input.question,
            conversationId: input.conversationId,
            target: input.target,
            ...(input.selectedText === undefined
              ? {}
              : { selectedText: input.selectedText }),
            ...(input.generateTitle === true ? { generateTitle: true } : {}),
          }),
        );
      } catch {
        return generationValidationFailure([
          { path: 'instruction.question', message: 'Question cannot be empty' },
        ]);
      }
    },
  });
