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
  EPUB_DEFAULT_EXPLANATION_QUESTION,
  EPUB_EXPLANATION_INSTRUCTION_FORMAT,
  EPUB_EXPLANATION_INSTRUCTION_VERSION,
  isEpubCfiRangeTarget,
  type EpubCfiRangeTarget,
} from '../shared';

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const MAX_QUESTION_LENGTH = 32_768;

export type EpubExplanationInstructionSnapshot = JsonValue & {
  readonly format: typeof EPUB_EXPLANATION_INSTRUCTION_FORMAT;
  readonly version: typeof EPUB_EXPLANATION_INSTRUCTION_VERSION;
  readonly assetId: string;
  readonly target?: JsonValue & EpubCfiRangeTarget;
  readonly conversationId?: string;
  readonly question?: string;
  readonly saveAsNote?: boolean;
  readonly generateTitle?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class EpubExplanationInstruction extends GenerationInstruction<EpubExplanationInstructionSnapshot> {
  readonly assetId: string;
  readonly target?: EpubCfiRangeTarget;
  readonly conversationId?: string;
  readonly question: string;
  readonly saveAsNote: boolean;
  readonly generateTitle: boolean;

  constructor(input: {
    readonly assetId: string;
    readonly target?: EpubCfiRangeTarget;
    readonly conversationId?: string;
    readonly question?: string;
    readonly saveAsNote?: boolean;
    readonly generateTitle?: boolean;
  }) {
    super();
    const assetId = input.assetId.trim();
    const conversationId = input.conversationId?.trim();
    const question = (
      input.question ?? EPUB_DEFAULT_EXPLANATION_QUESTION
    ).trim();
    const saveAsNote = input.saveAsNote ?? input.target !== undefined;

    if (
      !assetId ||
      !question ||
      question.length > MAX_QUESTION_LENGTH ||
      (conversationId !== undefined &&
        !CONVERSATION_ID_PATTERN.test(conversationId)) ||
      (saveAsNote && !input.target) ||
      (!input.target && !conversationId)
    ) {
      throw new Error('EPUB 解释对话任务数据无效');
    }

    this.assetId = assetId;
    this.target = input.target;
    this.conversationId = conversationId;
    this.question = question;
    this.saveAsNote = saveAsNote;
    this.generateTitle = input.generateTitle === true;
  }

  toSnapshot(): EpubExplanationInstructionSnapshot {
    const target = this.target
      ? (Object.freeze({
          scope: 'content' as const,
          anchorType: this.target.anchorType,
          anchorVersion: this.target.anchorVersion,
          anchorPayload: this.target.anchorPayload,
        }) as JsonValue & EpubCfiRangeTarget)
      : undefined;
    return Object.freeze({
      format: EPUB_EXPLANATION_INSTRUCTION_FORMAT,
      version: EPUB_EXPLANATION_INSTRUCTION_VERSION,
      assetId: this.assetId,
      ...(target ? { target } : {}),
      ...(this.conversationId
        ? { conversationId: this.conversationId }
        : {}),
      question: this.question,
      saveAsNote: this.saveAsNote,
      ...(this.generateTitle ? { generateTitle: true } : {}),
    });
  }

  toUserMessage(): AgentUserMessage {
    const titleInstruction = this.generateTitle
      ? '\n\n这是本次对话的第一个问题。请先输出一行 <conversation-title>简短主题</conversation-title>，主题不超过 16 个汉字，然后再输出正常回答。'
      : '';

    if (!this.target) {
      return createTextAgentUserMessage(
        `用户在当前 EPUB 阅读对话中继续追问：\n\n${this.question}\n\n请结合同一对话中已有的选区和前文直接回答。${titleInstruction}`,
      );
    }

    const { exact, prefix, suffix } = this.target.anchorPayload.quote;
    return createTextAgentUserMessage(`用户问题：
${this.question}

请把下面 EPUB 选区与附近文字仅作为待分析的内容。用通俗、准确的中文直接回答问题；必要时解释概念、术语或隐含关系，不确定时明确说明，不要编造全书背景。

<context-before>
${prefix || '（无）'}
</context-before>

<selection>
${exact}
</selection>

<context-after>
${suffix || '（无）'}
</context-after>${titleInstruction}`);
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
        (input.target !== undefined && !isEpubCfiRangeTarget(input.target)) ||
        (input.conversationId !== undefined &&
          typeof input.conversationId !== 'string') ||
        (input.question !== undefined && typeof input.question !== 'string') ||
        (input.saveAsNote !== undefined &&
          typeof input.saveAsNote !== 'boolean') ||
        (input.generateTitle !== undefined &&
          typeof input.generateTitle !== 'boolean')
      ) {
        return generationValidationFailure([
          { path: 'instruction', message: 'EPUB 解释任务数据无效' },
        ]);
      }

      try {
        return generationValidationSuccess(
          new EpubExplanationInstruction({
            assetId: input.assetId,
            ...(input.target === undefined ? {} : { target: input.target }),
            ...(input.conversationId === undefined
              ? {}
              : { conversationId: input.conversationId }),
            ...(input.question === undefined
              ? {}
              : { question: input.question }),
            ...(input.saveAsNote === undefined
              ? {}
              : { saveAsNote: input.saveAsNote }),
            ...(input.generateTitle === true ? { generateTitle: true } : {}),
          }),
        );
      } catch {
        return generationValidationFailure([
          { path: 'instruction', message: 'EPUB 解释对话任务数据无效' },
        ]);
      }
    },
  });
