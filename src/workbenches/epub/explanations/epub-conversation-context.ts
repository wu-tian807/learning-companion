import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  isEpubCfiRangeTarget,
  type EpubCfiRangeTarget,
} from './shared';

export const EPUB_CONVERSATION_CONTEXT_PROVIDER_ID = 'epub.context';

export type EpubConversationContext = JsonValue & {
  readonly target: EpubCfiRangeTarget;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isEpubConversationContext(
  value: unknown,
): value is EpubConversationContext {
  return isRecord(value) && isEpubCfiRangeTarget(value.target);
}

export function createEpubConversationContext(
  target: EpubCfiRangeTarget,
): EpubConversationContext {
  return Object.freeze({ target }) as EpubConversationContext;
}

export function describeEpubConversationContext(context: JsonValue) {
  return {
    label: 'EPUB 选区',
    ...(isEpubConversationContext(context)
      ? { detail: context.target.anchorPayload.quote.exact }
      : {}),
  };
}
