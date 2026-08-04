export type AgentUserMessagePart =
  | {
      readonly type: 'text';
      readonly text: string;
    }
  | {
      readonly type: 'local-image';
      readonly path: string;
      readonly detail?: 'auto' | 'low' | 'high' | 'original';
    }
  | {
      readonly type: 'local-audio';
      readonly path: string;
    };

export interface AgentUserMessage {
  readonly role: 'user';
  readonly content: readonly AgentUserMessagePart[];
}

export function cloneAgentUserMessage(
  message: AgentUserMessage,
): AgentUserMessage {
  if (message.role !== 'user' || message.content.length === 0) {
    throw new Error('Agent user message 数据无效');
  }

  return Object.freeze({
    role: 'user' as const,
    content: Object.freeze(
      message.content.map((part) => {
        if (part.type === 'text') {
          const text = part.text.trim();

          if (text.length === 0) {
            throw new Error('Agent user message text 不能为空');
          }

          return Object.freeze({ type: 'text' as const, text });
        }

        const path = part.path.trim();

        if (path.length === 0) {
          throw new Error('Agent user message local path 不能为空');
        }

        if (part.type === 'local-image') {
          if (
            part.detail !== undefined &&
            part.detail !== 'auto' &&
            part.detail !== 'low' &&
            part.detail !== 'high' &&
            part.detail !== 'original'
          ) {
            throw new Error('Agent user message image detail 数据无效');
          }

          return Object.freeze({
            type: 'local-image' as const,
            path,
            ...(part.detail ? { detail: part.detail } : {}),
          });
        }

        if (part.type !== 'local-audio') {
          throw new Error('Agent user message part 数据无效');
        }

        return Object.freeze({ type: 'local-audio' as const, path });
      }),
    ),
  });
}

export function createTextAgentUserMessage(text: string): AgentUserMessage {
  const normalized = text.trim();

  if (normalized.length === 0) {
    throw new Error('Agent user message 不能为空');
  }

  return Object.freeze({
    role: 'user',
    content: Object.freeze([
      Object.freeze({ type: 'text' as const, text: normalized }),
    ]),
  });
}
