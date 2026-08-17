import type {
  ConversationMessageRecord,
  ConversationRecord,
} from '../../../../renderer/conversation/conversation-contracts';
import type { ContentAnchorTarget } from '../../../../shared/workbench/anchor';
import { isDocumentConversationContext } from './document-conversation-contribution';

export interface QuestionAnchorEntry {
  readonly conversation: ConversationRecord;
  readonly message: ConversationMessageRecord;
  readonly target: ContentAnchorTarget;
}

export interface QuestionAnchorGroup {
  readonly key: string;
  readonly target: ContentAnchorTarget;
  readonly entries: readonly QuestionAnchorEntry[];
}

export function groupConversationQuestionAnchors(
  history: readonly ConversationRecord[],
): readonly QuestionAnchorGroup[] {
  const groups = new Map<string, QuestionAnchorEntry[]>();
  for (const conversation of history) {
    for (const message of conversation.messages) {
      if (
        message.role !== 'user' ||
        !isDocumentConversationContext(message.context) ||
        message.context.target.scope !== 'content'
      ) {
        continue;
      }
      const key = JSON.stringify(message.context.target);
      const entries = groups.get(key) ?? [];
      entries.push({
        conversation,
        message,
        target: message.context.target,
      });
      groups.set(key, entries);
    }
  }
  return [...groups.entries()].map(([key, entries]) => ({
    key,
    target: entries[0]!.target,
    entries: Object.freeze(
      entries.sort(
        (left, right) => left.message.createdTime - right.message.createdTime,
      ),
    ),
  }));
}
