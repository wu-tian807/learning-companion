export const HTML_CONVERSATION_ID_MAX_LENGTH = 128;

const htmlConversationIdPattern =
  /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;

export function isHtmlConversationId(
  value: unknown,
): value is string {
  return (
    typeof value === 'string' &&
    value.length <= HTML_CONVERSATION_ID_MAX_LENGTH &&
    htmlConversationIdPattern.test(value)
  );
}
