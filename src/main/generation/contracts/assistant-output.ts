/** Provider-neutral final output produced by one completed Agent call. */
export interface AssistantOutput {
  readonly text: string;
}

export function isAssistantOutput(
  output: unknown,
): output is AssistantOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'text' in output &&
    typeof output.text === 'string' &&
    output.text.trim().length > 0
  );
}

export function cloneAssistantOutput(
  output: AssistantOutput,
): AssistantOutput {
  if (!isAssistantOutput(output)) {
    throw new Error('AssistantOutput 数据无效');
  }

  return Object.freeze({ text: output.text });
}
