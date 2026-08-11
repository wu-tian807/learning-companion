import { ipcMain } from 'electron';

import { AppError } from '../../main/errors/app-error';
import type { GenerationTaskServiceApi } from '../../main/generation/generation-task-service';
import { registerIpcHandler } from '../../main/ipc/register-handler';
import {
  DOCUMENT_QUESTION_TASK_DEFINITION_ID,
  DOCUMENT_QUESTION_TASK_DEFINITION_VERSION,
} from '../../shared/generation-definitions';
import { isAssetTarget } from '../../shared/workbench/anchor';
import { DocumentQuestionInstruction } from './generation/document-question-instruction';
import type { DocumentQuestionTaskResult } from './generation/document-question-task-definition';
import {
  DOCUMENT_AI_IPC_CHANNELS,
  type DocumentAiRequest,
  type DocumentAiResponse,
} from './shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDocumentAiRequest(value: unknown): value is DocumentAiRequest {
  return (
    isRecord(value) &&
    typeof value.projectId === 'string' && value.projectId.trim().length > 0 &&
    typeof value.assetId === 'string' && value.assetId.trim().length > 0 &&
    typeof value.conversationId === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(value.conversationId) &&
    typeof value.question === 'string' && value.question.trim().length > 0 &&
    isAssetTarget(value.target) &&
    (value.selectedText === undefined || typeof value.selectedText === 'string')
  );
}

export async function askDocumentAi(
  tasks: GenerationTaskServiceApi,
  request: DocumentAiRequest,
): Promise<DocumentAiResponse> {
  const instruction = new DocumentQuestionInstruction({
    question: request.question,
    conversationId: request.conversationId,
    target: request.target,
    ...(request.selectedText ? { selectedText: request.selectedText } : {}),
  });
  const created = tasks.create({
    projectId: request.projectId.trim(),
    definitionId: DOCUMENT_QUESTION_TASK_DEFINITION_ID,
    definitionVersion: DOCUMENT_QUESTION_TASK_DEFINITION_VERSION,
    instruction: instruction.toSnapshot(),
    assetReferences: { document: [{ assetId: request.assetId.trim() }] },
  });
  const run = tasks.run(created.id);
  let next = await run.next();
  while (!next.done) next = await run.next();

  const result = next.value.result as DocumentQuestionTaskResult;
  if (
    typeof result.answer !== 'string' ||
    typeof result.providerId !== 'string' ||
    typeof result.modelId !== 'string'
  ) throw new AppError('DATA_INTEGRITY_ERROR');
  return result;
}

export function registerDocumentAiHandlers(tasks: GenerationTaskServiceApi): void {
  registerIpcHandler(DOCUMENT_AI_IPC_CHANNELS.ask, async (_event, request: unknown) => {
    if (!isDocumentAiRequest(request)) throw new AppError('INVALID_IPC_REQUEST');
    return askDocumentAi(tasks, request);
  });
}

export function removeDocumentAiHandlers(): void {
  ipcMain.removeHandler(DOCUMENT_AI_IPC_CHANNELS.ask);
}
