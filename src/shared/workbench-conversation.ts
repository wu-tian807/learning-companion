import { isJsonValue, type JsonValue } from './workbench/protocol';

export const WORKBENCH_CONVERSATION_TASK_DEFINITION_ID =
  'workbench.conversation';
export const WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION = 1;
export const WORKBENCH_CONVERSATION_INSTRUCTION_FORMAT =
  'learning-companion/workbench-conversation-instruction';
export const WORKBENCH_CONVERSATION_INSTRUCTION_VERSION = 1;
export const WORKBENCH_CONVERSATION_SOURCE_SLOT = 'source';
export const PROJECT_CONVERSATION_CONTEXT_PROVIDER_ID =
  'builtin.project.conversation';

export interface WorkbenchConversationTaskResultFields {
  readonly answer: string;
  readonly title?: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly contextResult?: JsonValue;
}

export type WorkbenchConversationTaskResult = JsonValue &
  WorkbenchConversationTaskResultFields;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isWorkbenchConversationTaskResult(
  value: unknown,
): value is WorkbenchConversationTaskResult {
  return (
    isRecord(value) &&
    isRequiredText(value.answer) &&
    (value.title === undefined || typeof value.title === 'string') &&
    isRequiredText(value.providerId) &&
    isRequiredText(value.modelId) &&
    (value.contextResult === undefined ||
      isJsonValue(value.contextResult))
  );
}
