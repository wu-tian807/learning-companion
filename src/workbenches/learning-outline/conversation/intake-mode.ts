import type { GenerationTaskView } from '../../../shared/generation-tasks';
import {
  LEARNING_OUTLINE_INTAKE_MODE_ID,
  LEARNING_OUTLINE_INTAKE_TASK_DEFINITION_ID,
  LEARNING_OUTLINE_INTAKE_TASK_DEFINITION_VERSION,
} from '../shared';
import type { StartGenerationTaskRequest } from '../../../shared/generation-tasks';
import type { ConversationModeDefinition } from '../../../renderer/conversation/conversation-mode';
import type { ConversationTaskInput } from '../../../renderer/conversation/conversation-contracts';
import { LearningOutlineIntakeStatus } from './intake-status';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const learningOutlineIntakeMode: ConversationModeDefinition =
  Object.freeze({
    id: LEARNING_OUTLINE_INTAKE_MODE_ID,
    task: Object.freeze({
      createRequest(input: ConversationTaskInput): StartGenerationTaskRequest {
        if (!input.boundAssetId) {
          throw new Error('学习大纲会话缺少绑定 Asset。');
        }
        if (input.context !== undefined && !input.contextSource) {
          throw new Error('学习大纲上下文缺少来源。');
        }
        const sourceAssetIds = [
          input.assetId,
          ...(input.contextSource?.contextAssetIds ?? []),
        ].filter((assetId): assetId is string => Boolean(assetId));
        return Object.freeze({
          projectId: input.projectId,
          definitionId: LEARNING_OUTLINE_INTAKE_TASK_DEFINITION_ID,
          definitionVersion: LEARNING_OUTLINE_INTAKE_TASK_DEFINITION_VERSION,
          instruction: Object.freeze({
            format: 'learning-companion/learning-outline-intake',
            version: 1,
            conversationId: input.conversationId,
            boundAssetId: input.boundAssetId,
            question: input.question,
            ...(input.generateTitle ? { generateTitle: true } : {}),
            ...(input.assetId ? { assetId: input.assetId } : {}),
            ...(input.context === undefined ? {} : { context: input.context }),
            ...(input.contextSource
              ? { contextSource: input.contextSource }
              : {}),
          }) as unknown as import('../../../shared/workbench/protocol').JsonValue,
          assetReferences: Object.freeze({
            source: Object.freeze(
              [...new Set(sourceAssetIds)].map((assetId) => ({ assetId })),
            ),
          }),
        });
      },
      readCompletion(task: GenerationTaskView) {
        const result = task.result;
        if (!isRecord(result) || typeof result.answer !== 'string') {
          return undefined;
        }
        return Object.freeze({
          answer: result.answer,
          ...(typeof result.title === 'string' ? { title: result.title } : {}),
          ...(typeof result.providerId === 'string' &&
          typeof result.modelId === 'string'
            ? { modelInfo: `${result.providerId}/${result.modelId}` }
            : {}),
        });
      },
    }),
    presentation: Object.freeze({
      title: '学习大纲需求',
      ariaLabel: '学习大纲需求对话',
      emptyLabel: '先告诉我你想学什么，我会帮你整理需求。',
      inputPlaceholder: '描述你想达成的学习目标…',
      allowNewConversation: false,
      status: LearningOutlineIntakeStatus,
    }),
  });
