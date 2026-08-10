/**
 * 取消 AI 回答的纯逻辑（renderer 层，可独立测试）。
 *
 * 流式 delta 只是体验增强，不是权威结果。任务取消后移除对应的
 * assistant 临时消息，避免把不完整 delta 作为普通最终回答写入历史。
 */
export interface DisplayMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly streaming?: boolean;
}

/** 取消流式回答：移除目标 assistant 临时消息，保留用户问题。 */
export function applyCancellation(
  messages: readonly DisplayMessage[],
  streamingMessageId: string,
): DisplayMessage[] {
  return messages.filter(
    (message) =>
      message.id !== streamingMessageId || !message.streaming,
  );
}
