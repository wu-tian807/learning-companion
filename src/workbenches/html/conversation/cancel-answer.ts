/**
 * 取消 AI 回答的纯逻辑（renderer 层，可独立测试）。
 *
 * 流式 delta 只是体验增强，不是权威结果。任务取消后保留已生成的部分文本，
 * 标记为「已停止」，避免把不完整 delta 当作普通完整回答写入历史，
 * 也避免用户点「停止」后已生成的内容凭空消失（Codex thread 仍保留上下文，
 * UI 层不应丢掉本地展示）。
 */
export interface DisplayMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly streaming?: boolean;
  /** 取消（停止）后保留的半截回答。 */
  readonly stopped?: boolean;
}

/** 取消流式回答：保留已生成的部分文本并标记 stopped，保留用户问题。 */
export function applyCancellation(
  messages: readonly DisplayMessage[],
  streamingMessageId: string,
): DisplayMessage[] {
  return messages.map((message) =>
    message.id === streamingMessageId && message.streaming
      ? {
          ...message,
          streaming: false,
          stopped: true,
        }
      : message,
  );
}
