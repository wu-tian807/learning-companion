import {
  DOCUMENT_QUESTION_INSTRUCTION_FORMAT,
  DOCUMENT_QUESTION_INSTRUCTION_VERSION,
  DOCUMENT_QUESTION_TASK_DEFINITION_ID,
  DOCUMENT_QUESTION_TASK_DEFINITION_VERSION,
} from '../../../shared/generation-definitions';
import type { StartGenerationTaskRequest } from '../../../shared/generation-tasks';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { runGenerationTask } from '../../../renderer/generation/run-generation-task';
import {
  isDocumentQuestionTaskResult,
  type DocumentAiRequest,
  type DocumentAiResponse,
} from '../shared';

export type DocumentAiTaskRunner = (
  request: StartGenerationTaskRequest,
  options: { readonly signal: AbortSignal },
) => ReturnType<typeof runGenerationTask>;

export interface DocumentAiClient {
  ask(request: DocumentAiRequest): Promise<DocumentAiResponse>;
  cancel(requestId: string): void;
}

export function createDocumentAiClient(
  runTask: DocumentAiTaskRunner = runGenerationTask,
): DocumentAiClient {
  const activeRequests = new Map<string, AbortController>();

  return {
    async ask(request) {
      if (activeRequests.has(request.requestId)) {
        throw new Error(`Document AI request is already active: ${request.requestId}`);
      }

      const controller = new AbortController();
      activeRequests.set(request.requestId, controller);
      try {
        const task = await runTask(
          {
            projectId: request.projectId,
            definitionId: DOCUMENT_QUESTION_TASK_DEFINITION_ID,
            definitionVersion: DOCUMENT_QUESTION_TASK_DEFINITION_VERSION,
            instruction: {
              format: DOCUMENT_QUESTION_INSTRUCTION_FORMAT,
              version: DOCUMENT_QUESTION_INSTRUCTION_VERSION,
              question: request.question,
              conversationId: request.conversationId,
              target: request.target as unknown as JsonValue,
              ...(request.selectedText === undefined
                ? {}
                : { selectedText: request.selectedText }),
              ...(request.generateTitle === true
                ? { generateTitle: true }
                : {}),
            },
            assetReferences: {
              document: [{ assetId: request.assetId }],
            },
          },
          { signal: controller.signal },
        );

        if (!isDocumentQuestionTaskResult(task.result)) {
          throw new Error('Document AI task returned an invalid result');
        }
        return task.result;
      } finally {
        if (activeRequests.get(request.requestId) === controller) {
          activeRequests.delete(request.requestId);
        }
      }
    },

    cancel(requestId) {
      activeRequests.get(requestId)?.abort();
    },
  };
}

export const documentAiClient = createDocumentAiClient();
