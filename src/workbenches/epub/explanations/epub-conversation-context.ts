import type { JsonValue } from '../../../shared/workbench/protocol';
import { parseAssetTarget } from '../../../shared/workbench/asset-target';
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

export function parseEpubConversationContext(
  value: unknown,
): EpubConversationContext | undefined {
  if (!isRecord(value)) return undefined;
  const target = parseAssetTarget(value.target);
  if (!target) return undefined;
  const normalized = { target };
  return isEpubConversationContext(normalized)
    ? Object.freeze(normalized) as EpubConversationContext
    : undefined;
}

export function createEpubConversationContext(
  target: EpubCfiRangeTarget,
): EpubConversationContext {
  return Object.freeze({ target }) as EpubConversationContext;
}
