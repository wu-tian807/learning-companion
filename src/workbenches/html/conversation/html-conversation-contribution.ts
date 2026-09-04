import type {
  WorkbenchConversationContribution,
} from '../../../renderer/conversation/conversation-contracts';
import type { JsonValue } from '../../../shared/workbench/protocol';
import type { HtmlAnchorTarget } from '../anchor-commands';
import {
  HTML_CONVERSATION_CONTEXT_PROVIDER_ID,
  parseHtmlConversationContext,
} from './html-conversation-context';

export function shouldClearHtmlConversationHighlight(
  released: JsonValue | undefined,
  active: HtmlAnchorTarget | undefined,
): boolean {
  const releasedTarget = parseHtmlConversationContext(released);
  return (
    released === undefined ||
    !releasedTarget ||
    active === undefined ||
    JSON.stringify(releasedTarget) === JSON.stringify(active)
  );
}

export function createHtmlConversationContribution(input: {
  readonly onContextReleased?: (context: JsonValue | undefined) => void;
}): WorkbenchConversationContribution {
  const contribution: WorkbenchConversationContribution = {
    contextProviderId: HTML_CONVERSATION_CONTEXT_PROVIDER_ID,
    sourceAssetMode: 'reference',
    isContext: (context) =>
      parseHtmlConversationContext(context) !== undefined,
    onContextReleased: input.onContextReleased,
  };
  return Object.freeze(contribution);
}
