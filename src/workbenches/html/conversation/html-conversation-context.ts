import { isHtmlAnchorTarget, type HtmlAnchorTarget } from '../anchor-commands';

export const HTML_CONVERSATION_CONTEXT_PROVIDER_ID = 'html.context';

export type HtmlConversationContext = HtmlAnchorTarget;

export const isHtmlConversationContext = isHtmlAnchorTarget;
