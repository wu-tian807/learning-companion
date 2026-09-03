import { parseAssetTarget } from '../../../shared/workbench/asset-target';
import { isHtmlAnchorTarget, type HtmlAnchorTarget } from '../anchor-commands';

export const HTML_CONVERSATION_CONTEXT_PROVIDER_ID = 'html.context';

export type HtmlConversationContext = HtmlAnchorTarget;

export const isHtmlConversationContext = isHtmlAnchorTarget;

export function parseHtmlConversationContext(
  value: unknown,
): HtmlConversationContext | undefined {
  const target = parseAssetTarget(value);
  return target && isHtmlConversationContext(target)
    ? target
    : undefined;
}
