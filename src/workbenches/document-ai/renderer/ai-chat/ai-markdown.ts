/** Convert the LaTeX delimiters commonly emitted by AI models into the
 * dollar delimiters understood by remark-math. */
export function normalizeAiMarkdown(value: string): string {
  return value
    .replace(/\\\[/gu, () => '\n$$\n')
    .replace(/\\\]/gu, () => '\n$$\n')
    .replace(/\\\(([\s\S]*?)\\\)/gu, (_match, expression: string) =>
      `$${expression}$`,
    );
}

/** Browser selections from rendered KaTeX can contain a line break between
 * almost every glyph. Keep real paragraph breaks while removing those
 * presentation-only breaks before an answer is attached. */
export function normalizeSelectedAnswerText(value: string): string {
  const paragraphBreak = '\uE000';
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]*\n[ \t]*\n+[ \t]*/gu, paragraphBreak)
    .replace(/[ \t]*\n[ \t]*/gu, ' ')
    .replace(/[ \t]{2,}/gu, ' ')
    .replaceAll(paragraphBreak, '\n\n')
    .trim();
}
