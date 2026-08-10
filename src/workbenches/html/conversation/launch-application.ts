/**
 * launchRequest 消费的纯逻辑（renderer 层，可独立测试）。
 *
 * 把「请求 → 待发送锚点 / 自动提交规格」的转换抽成纯函数，
 * 让 ConversationOverlay 组件只负责调用，避免 effect 时序问题。
 */
import type { JsonValue } from '../../../shared/workbench/protocol';
import type { HtmlAiLaunchRequest } from './html-ai-launch';

/** 待发送锚点：null 表示「显式清除」，undefined 表示「未变化」。 */
export type PendingAnchorValue = JsonValue | null | undefined;

/** 应用启动请求的结果。 */
export interface LaunchApplicationResult {
  readonly pendingAnchor: PendingAnchorValue;
  /** 需要自动提交的任务规格；undefined 表示本次请求不自动提交。 */
  readonly autoSubmit: LaunchSubmitSpec | undefined;
}

/** 自动提交规格：question 必填，anchor 缺省表示不带锚点。 */
export interface LaunchSubmitSpec {
  readonly question: string;
  readonly anchor?: JsonValue;
}

export function createSubmitSpec(
  question: string,
  anchor?: JsonValue,
): LaunchSubmitSpec | undefined {
  const normalized = question.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return {
    question: normalized,
    ...(anchor === undefined ? {} : { anchor }),
  };
}

/** 把启动请求转换为「待发送锚点 + 自动提交规格」。 */
export function applyLaunchRequest(
  request: HtmlAiLaunchRequest,
): LaunchApplicationResult {
  if (request.intent === 'open-chat') {
    return {
      pendingAnchor: request.anchor,
      autoSubmit: undefined,
    };
  }

  if (request.intent === 'explain-selection') {
    // 引用选中内容：固定锚点，用户自己提问（不预填、不自动提交）。
    return {
      pendingAnchor: request.anchor,
      autoSubmit: undefined,
    };
  }

  // summarize-page：显式清除旧锚点（null），自动提交不带锚点的问题。
  return {
    pendingAnchor: null,
    autoSubmit: createSubmitSpec(request.question),
  };
}
