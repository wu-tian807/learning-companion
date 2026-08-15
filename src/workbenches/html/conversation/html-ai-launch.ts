/**
 * AI 启动请求模型（renderer 层）。
 *
 * 把「打开对话」「引用选中内容」「总结当前页面」三个入口在类型层面分开，
 * 避免不同按钮共用同一个 `openAi(anchor)` 回调后行为绑死在一起。
 * 请求由 renderer 构造，经 `launchRequest` prop 交给 ConversationOverlay 消费。
 * 不在该层做持久化：最终任务仍走现有 `question + anchor` instruction 协议。
 */
import type { JsonValue } from '../../../shared/workbench/protocol';
import { isJsonValue } from '../../../shared/workbench/protocol';

export type HtmlAiLaunchRequest =
  | {
      readonly id: number;
      readonly intent: 'open-chat';
      readonly anchor: JsonValue | null;
      readonly submit: 'draft';
    }
  | {
      readonly id: number;
      readonly intent: 'explain-selection';
      readonly anchor: JsonValue;
      readonly submit: 'draft';
    }
  | {
      readonly id: number;
      readonly intent: 'summarize-page';
      readonly anchor: null;
      readonly question: string;
      readonly submit: 'auto';
    };

/** 总结当前页面的固定问题。 */
export const HTML_SUMMARIZE_PAGE_QUESTION =
  '请总结当前 HTML 页面。先概括页面主题和核心结论，再按结构梳理主要内容、关键概念与重要细节；不要只解释当前选区。';

export function isHtmlAiLaunchRequest(
  value: unknown,
): value is HtmlAiLaunchRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(record.id) ||
    Number(record.id) <= 0
  ) {
    return false;
  }
  if (record.intent === 'open-chat') {
    return (
      record.submit === 'draft' &&
      isJsonValue(record.anchor)
    );
  }
  if (record.intent === 'explain-selection') {
    return (
      record.submit === 'draft' &&
      record.anchor !== null &&
      isJsonValue(record.anchor)
    );
  }
  if (record.intent === 'summarize-page') {
    return (
      record.submit === 'auto' &&
      record.anchor === null &&
      typeof record.question === 'string' &&
      record.question.trim().length > 0
    );
  }
  return false;
}

/** 普通打开 AI 对话：不自动提交，可携带当前焦点锚点。 */
export function createOpenChatRequest(
  id: number,
  anchor?: JsonValue,
): HtmlAiLaunchRequest {
  return {
    id,
    intent: 'open-chat',
    anchor: anchor ?? null,
    submit: 'draft',
  };
}

/** 引用选中内容：固定锚点，由用户自己提问（不预填、不自动提交）。 */
export function createExplainSelectionRequest(
  id: number,
  anchor: JsonValue,
): HtmlAiLaunchRequest {
  return {
    id,
    intent: 'explain-selection',
    anchor,
    submit: 'draft',
  };
}

/** 总结当前页面：明确无锚点（null 表示清除旧锚点）并自动提交专用问题。 */
export function createSummarizePageRequest(
  id: number,
): HtmlAiLaunchRequest {
  return {
    id,
    intent: 'summarize-page',
    anchor: null,
    question: HTML_SUMMARIZE_PAGE_QUESTION,
    submit: 'auto',
  };
}
