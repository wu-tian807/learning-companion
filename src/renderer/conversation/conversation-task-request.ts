import {
  WORKBENCH_CONVERSATION_INSTRUCTION_FORMAT,
  WORKBENCH_CONVERSATION_INSTRUCTION_VERSION,
  WORKBENCH_CONVERSATION_SOURCE_SLOT,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../shared/workbench-conversation';
import type { StartGenerationTaskRequest } from '../../shared/generation-tasks';
import type {
  ConversationTaskInput,
  WorkbenchConversationContribution,
} from './conversation-contracts';

export function createWorkbenchConversationTaskRequest(
  contribution: WorkbenchConversationContribution,
  input: ConversationTaskInput,
): StartGenerationTaskRequest {
  if (
    input.generateTitle &&
    contribution.initialContextRequired &&
    input.context === undefined
  ) {
    throw new Error(
      contribution.initialContextRequiredMessage ??
        '请先选择需要提问的内容。',
    );
  }
  if (
    input.context !== undefined &&
    contribution.isContext &&
    !contribution.isContext(input.context)
  ) {
    throw new Error('当前聊天上下文无效，请重新选择。');
  }

  const commitAnswer =
    input.context !== undefined &&
    contribution.shouldCommitAnswer?.(input) === true;

  return Object.freeze({
    projectId: input.projectId,
    definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
    definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
    instruction: Object.freeze({
      format: WORKBENCH_CONVERSATION_INSTRUCTION_FORMAT,
      version: WORKBENCH_CONVERSATION_INSTRUCTION_VERSION,
      contextProviderId: contribution.contextProviderId,
      assetId: input.assetId,
      conversationId: input.conversationId,
      question: input.question,
      ...(input.context === undefined ? {} : { context: input.context }),
      ...(commitAnswer ? { commitAnswer: true } : {}),
      ...(input.generateTitle ? { generateTitle: true } : {}),
    }),
    assetReferences: contribution.includeSourceAssetReference
      ? Object.freeze({
          [WORKBENCH_CONVERSATION_SOURCE_SLOT]: Object.freeze([
            Object.freeze({ assetId: input.assetId }),
          ]),
        })
      : Object.freeze({}),
  });
}
