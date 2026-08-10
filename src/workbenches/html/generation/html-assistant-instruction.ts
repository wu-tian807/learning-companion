import type { JsonValue } from '../../../shared/workbench/protocol';
import { isJsonValue } from '../../../shared/workbench/protocol';
import {
  HTML_ASSISTANT_INSTRUCTION_FORMAT,
  HTML_ASSISTANT_INSTRUCTION_VERSION,
} from '../../../shared/generation-definitions';
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
import { isHtmlConversationId } from '../conversation/conversation-id';

export {
  HTML_ASSISTANT_INSTRUCTION_FORMAT,
  HTML_ASSISTANT_INSTRUCTION_VERSION,
} from '../../../shared/generation-definitions';

export const HTML_ASSISTANT_QUESTION_MAX_LENGTH = 2_000;

export type HtmlAssistantInstructionSnapshot = JsonValue & {
  readonly format: typeof HTML_ASSISTANT_INSTRUCTION_FORMAT;
  readonly version: typeof HTML_ASSISTANT_INSTRUCTION_VERSION;
  readonly conversationId: string;
  readonly question: string;
  readonly anchor?: JsonValue;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeAnchor(anchor: JsonValue): string {
  if (isRecord(anchor)) {
    const kind =
      anchor.anchorType === 'html.element'
        ? '元素'
        : anchor.anchorType === 'html.quote'
          ? '选中文本'
          : anchor.anchorType === 'html.link'
            ? '链接'
            : '内容';
    const payload = isRecord(anchor.anchorPayload)
      ? anchor.anchorPayload
      : undefined;

    if (anchor.anchorType === 'html.quote') {
      const exact =
        typeof payload?.exact === 'string' && payload.exact.trim().length > 0
          ? payload.exact
          : undefined;
      return exact ? `${kind}：「${exact}」` : kind;
    }

    if (anchor.anchorType === 'html.element') {
      const parts: string[] = [];
      if (typeof payload?.id === 'string' && payload.id.trim().length > 0) {
        parts.push(`#${payload.id}`);
      }
      if (typeof payload?.tagName === 'string') {
        parts.push(payload.tagName);
      }
      if (
        typeof payload?.textQuote === 'string' &&
        payload.textQuote.trim().length > 0
      ) {
        parts.push(`「${payload.textQuote.slice(0, 80)}」`);
      }
      return parts.length > 0 ? `${kind}：${parts.join(' ')}` : kind;
    }

    if (anchor.anchorType === 'html.link') {
      const url =
        typeof payload?.url === 'string' && payload.url.trim().length > 0
          ? payload.url
          : undefined;
      return url ? `${kind}：${url}` : kind;
    }
  }

  return '当前内容';
}

export class HtmlAssistantInstruction extends GenerationInstruction<HtmlAssistantInstructionSnapshot> {
  readonly conversationId: string;
  readonly question: string;
  readonly anchor?: JsonValue;

  constructor(input: {
    readonly conversationId: string;
    readonly question: string;
    readonly anchor?: JsonValue;
  }) {
    super();
    const normalized = input.question.trim();

    if (!isHtmlConversationId(input.conversationId)) {
      throw new Error('HtmlAssistant conversationId 数据无效');
    }
    if (normalized.length === 0) {
      throw new Error('HtmlAssistant question 不能为空');
    }
    if (normalized.length > HTML_ASSISTANT_QUESTION_MAX_LENGTH) {
      throw new Error('HtmlAssistant question 超出长度上限');
    }
    if (input.anchor !== undefined && !isJsonValue(input.anchor)) {
      throw new Error('HtmlAssistant anchor 不是 JSON 值');
    }

    this.conversationId = input.conversationId;
    this.question = normalized;
    this.anchor = input.anchor;
  }

  toSnapshot(): HtmlAssistantInstructionSnapshot {
    return Object.freeze({
      format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
      version: HTML_ASSISTANT_INSTRUCTION_VERSION,
      conversationId: this.conversationId,
      question: this.question,
      ...(this.anchor !== undefined ? { anchor: this.anchor } : {}),
    });
  }

  toUserMessage(): AgentUserMessage {
    const parts = [
      '用户正在阅读一份 HTML 资料，并提出了以下问题。请结合参考资料与问题中的上下文，用中文给出清晰、准确的回答。',
      `问题：${this.question}`,
      this.anchor !== undefined
        ? `用户选中/聚焦的内容：${describeAnchor(this.anchor)}`
        : '用户没有指定具体选中内容，请基于整个资料回答。',
    ];

    return createTextAgentUserMessage(parts.join('\n\n'));
  }
}

export const htmlAssistantInstructionFactory: GenerationInstructionFactory<HtmlAssistantInstruction> =
  Object.freeze({
    parse(input: JsonValue) {
      if (
        !isRecord(input) ||
        input.format !== HTML_ASSISTANT_INSTRUCTION_FORMAT ||
        input.version !== HTML_ASSISTANT_INSTRUCTION_VERSION ||
        !isHtmlConversationId(input.conversationId) ||
        typeof input.question !== 'string' ||
        input.question.trim().length === 0 ||
        input.question.length > HTML_ASSISTANT_QUESTION_MAX_LENGTH ||
        (input.anchor !== undefined && !isJsonValue(input.anchor))
      ) {
        return generationValidationFailure([
          {
            path: 'instruction',
            message: 'HtmlAssistant instruction 数据无效',
          },
        ]);
      }

      return generationValidationSuccess(
        new HtmlAssistantInstruction({
          conversationId: input.conversationId,
          question: input.question,
          ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
        }),
      );
    },
  });
