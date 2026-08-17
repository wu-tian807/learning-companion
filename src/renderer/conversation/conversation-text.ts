export function normalizeConversationMarkdown(value: string): string {
  return value
    .replace(/\\\[/gu, () => '\n$$\n')
    .replace(/\\\]/gu, () => '\n$$\n')
    .replace(/\\\(([\s\S]*?)\\\)/gu, (_match, expression: string) =>
      `$${expression}$`,
    );
}

export function normalizeConversationSelection(value: string): string {
  const paragraphBreak = '\uE000';
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]*\n[ \t]*\n+[ \t]*/gu, paragraphBreak)
    .replace(/[ \t]*\n[ \t]*/gu, ' ')
    .replace(/[ \t]{2,}/gu, ' ')
    .replaceAll(paragraphBreak, '\n\n')
    .trim();
}
