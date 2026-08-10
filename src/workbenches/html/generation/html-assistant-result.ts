import type { JsonValue } from '../../../shared/workbench/protocol';

export type HtmlAssistantTaskResult = JsonValue & {
  readonly answer: string;
};

export function isHtmlAssistantTaskResult(
  value: unknown,
): value is HtmlAssistantTaskResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'answer' in value &&
    typeof value.answer === 'string' &&
    value.answer.trim().length > 0
  );
}
