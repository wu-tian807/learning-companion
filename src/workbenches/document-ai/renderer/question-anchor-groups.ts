import type { ContentAnchorTarget } from '../../../shared/workbench/anchor';
import type { AiChatMessage } from './ai-chat/chat-store';

export interface QuestionAnchorGroup {
  readonly key: string;
  readonly target: ContentAnchorTarget;
  readonly questions: readonly AiChatMessage[];
}

export function groupQuestionAnchors(
  messages: readonly AiChatMessage[],
): readonly QuestionAnchorGroup[] {
  const groups = new Map<string, QuestionAnchorGroup>();
  for (const message of messages) {
    if (message.role !== 'user' || !message.anchor) continue;
    const key = JSON.stringify(message.anchor.target);
    const existing = groups.get(key);
    groups.set(key, {
      key,
      target: message.anchor.target,
      questions: [...(existing?.questions ?? []), message],
    });
  }
  return [...groups.values()];
}
