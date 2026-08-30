import type { StartGenerationTaskRequest } from '../../shared/generation-tasks';
import type { ConversationMessageContextSource } from '../../shared/project-conversations';
import {
  PROJECT_CONVERSATION_CONTEXT_PROVIDER_ID,
  WORKBENCH_CONVERSATION_INSTRUCTION_FORMAT,
  WORKBENCH_CONVERSATION_INSTRUCTION_VERSION,
  WORKBENCH_CONVERSATION_SOURCE_SLOT,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../shared/workbench-conversation';
import type {
  ConversationTaskInput,
  WorkbenchConversationContribution,
} from './conversation-contracts';

export function createConversationContextSource(
  contribution: WorkbenchConversationContribution,
  input: ConversationTaskInput,
): ConversationMessageContextSource {
  if (contribution.sourceAssetMode && !input.assetId) {
    throw new Error('当前问答上下文缺少资料。');
  }
  if (
    contribution.contextRequired &&
    input.context === undefined
  ) {
    throw new Error(
      contribution.contextRequiredMessage ??
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
    contributionId: contribution.id,
    contextProviderId: contribution.contextProviderId,
    ...(input.assetId ? { assetId: input.assetId } : {}),
    ...(contribution.sourceAssetMode
      ? { sourceAssetMode: contribution.sourceAssetMode }
      : {}),
    ...(commitAnswer ? { commitAnswer: true as const } : {}),
  });
}

export function createConversationTaskRequest(
  input: ConversationTaskInput,
): StartGenerationTaskRequest {
  const source = input.contextSource;
  if (input.context !== undefined && !source) {
    throw new Error('当前聊天上下文缺少来源。');
  }

  return Object.freeze({
    projectId: input.projectId,
    definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
    definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
    instruction: Object.freeze({
      format: WORKBENCH_CONVERSATION_INSTRUCTION_FORMAT,
      version: WORKBENCH_CONVERSATION_INSTRUCTION_VERSION,
      contextProviderId:
        source?.contextProviderId ??
        PROJECT_CONVERSATION_CONTEXT_PROVIDER_ID,
      ...(source?.sourceAssetMode && source.assetId
        ? { assetId: source.assetId }
        : {}),
      conversationId: input.conversationId,
      question: input.question,
      ...(input.context === undefined ? {} : { context: input.context }),
      ...(source?.commitAnswer ? { commitAnswer: true } : {}),
      ...(input.generateTitle ? { generateTitle: true } : {}),
    }),
    assetReferences:
      source?.sourceAssetMode === 'reference' && source.assetId
        ? Object.freeze({
            [WORKBENCH_CONVERSATION_SOURCE_SLOT]: Object.freeze([
              Object.freeze({ assetId: source.assetId }),
            ]),
          })
        : Object.freeze({}),
  });
}

export function createContextualConversationTaskRequest(
  contribution: WorkbenchConversationContribution,
  input: ConversationTaskInput,
): StartGenerationTaskRequest {
  return createConversationTaskRequest({
    ...input,
    contextSource: createConversationContextSource(
      contribution,
      input,
    ),
  });
}
