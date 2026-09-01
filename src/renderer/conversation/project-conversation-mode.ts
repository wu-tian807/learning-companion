import { PROJECT_CONVERSATION_MODE_ID } from '../../shared/project-conversations';
import type { GenerationTaskView } from '../../shared/generation-tasks';
import { isWorkbenchConversationTaskResult } from '../../shared/workbench-conversation';
import type { ConversationModeDefinition } from './conversation-mode';
import {
  PROJECT_CONVERSATION_EMPTY_LABEL,
  PROJECT_CONVERSATION_INPUT_PLACEHOLDER,
  PROJECT_CONVERSATION_TITLE,
} from './project-conversation-presentation';
import { createConversationTaskRequest } from './conversation-task-request';

export const projectConversationMode: ConversationModeDefinition =
  Object.freeze({
    id: PROJECT_CONVERSATION_MODE_ID,
    task: Object.freeze({
      createRequest: createConversationTaskRequest,
      readCompletion(task: GenerationTaskView) {
        if (!isWorkbenchConversationTaskResult(task.result)) {
          return undefined;
        }
        return Object.freeze({
          answer: task.result.answer,
          ...(task.result.title ? { title: task.result.title } : {}),
          modelInfo: `${task.result.providerId}/${task.result.modelId}`,
        });
      },
    }),
    presentation: Object.freeze({
      title: PROJECT_CONVERSATION_TITLE,
      ariaLabel: PROJECT_CONVERSATION_TITLE,
      emptyLabel: PROJECT_CONVERSATION_EMPTY_LABEL,
      inputPlaceholder: PROJECT_CONVERSATION_INPUT_PLACEHOLDER,
    }),
  });
