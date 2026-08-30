import type {
  WorkbenchConversationContribution,
} from '../../../renderer/conversation/conversation-contracts';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { isHtmlAnchorTarget, type HtmlAnchorTarget } from '../anchor-commands';
import { htmlWorkbenchManifest } from '../shared';
import { describeHtmlConversationContext } from './anchor-summary';
import { HTML_CONVERSATION_CONTEXT_PROVIDER_ID } from './html-conversation-context';

export function shouldClearHtmlConversationHighlight(
  released: JsonValue | undefined,
  active: HtmlAnchorTarget | undefined,
): boolean {
  return (
    released === undefined ||
    !isHtmlAnchorTarget(released) ||
    active === undefined ||
    JSON.stringify(released) === JSON.stringify(active)
  );
}

export function createHtmlConversationContribution(input: {
  readonly assetId: string;
  readonly revealContext: (context: JsonValue) => Promise<void> | void;
  readonly onContextReleased?: (context: JsonValue | undefined) => void;
}): WorkbenchConversationContribution {
  const contribution: WorkbenchConversationContribution = {
    id: 'html.assistant',
    workbenchId: htmlWorkbenchManifest.id,
    contextProviderId: HTML_CONVERSATION_CONTEXT_PROVIDER_ID,
    sourceAssetMode: 'reference',
    isContext: isHtmlAnchorTarget,
    describeContext(context) {
      return isHtmlAnchorTarget(context)
        ? describeHtmlConversationContext(context)
        : { label: 'HTML 内容' };
    },
    revealContext: input.revealContext,
    onContextReleased: input.onContextReleased,
  };
  return Object.freeze(contribution);
}
