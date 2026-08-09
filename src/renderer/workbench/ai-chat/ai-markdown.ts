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
