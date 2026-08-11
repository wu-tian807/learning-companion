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

const DOCUMENT_AI_REQUEST_KEYS = new Set([
  'projectId', 'assetId', 'requestId', 'conversationId',
  'question', 'target', 'selectedText',
]);

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(value);
}

export function isDocumentAiRequest(value: unknown): value is DocumentAiRequest {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => DOCUMENT_AI_REQUEST_KEYS.has(key)) &&
    typeof value.projectId === 'string' && value.projectId.trim().length > 0 &&
    typeof value.assetId === 'string' && value.assetId.trim().length > 0 &&
    isRequestId(value.requestId) &&
    typeof value.conversationId === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(value.conversationId) &&
    typeof value.question === 'string' && value.question.trim().length > 0 &&
    isAssetTarget(value.target) &&
    (value.selectedText === undefined || typeof value.selectedText === 'string')
  );
}

export async function askDocumentAi(
  tasks: GenerationTaskServiceApi,
  request: DocumentAiRequest,
  onCreated?: (taskId: string) => void,
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
  onCreated?.(created.id);
  const run = tasks.run(created.id);
  let next = await run.next();
  while (!next.done) next = await run.next();

  const result = next.value.result as DocumentQuestionTaskResult;
  if (
    typeof result.answer !== 'string' || result.answer.trim().length === 0 ||
    typeof result.providerId !== 'string' || result.providerId.trim().length === 0 ||
    typeof result.modelId !== 'string' || result.modelId.trim().length === 0
  ) throw new AppError('DATA_INTEGRITY_ERROR');
  return result;
}

export class DocumentAiActiveRequests {
  private readonly taskIds = new Map<string, string | undefined>();
  private readonly cancelledBeforeTrack = new Set<string>();

  constructor(private readonly tasks: Pick<GenerationTaskServiceApi, 'cancel'>) {}

  start(requestId: string): boolean {
    if (this.taskIds.has(requestId)) return false;
    this.taskIds.set(requestId, undefined);
    return true;
  }

  track(requestId: string, taskId: string): void {
    if (this.cancelledBeforeTrack.delete(requestId)) {
      this.tasks.cancel(taskId);
      return;
    }
    if (!this.taskIds.has(requestId)) return;
    this.taskIds.set(requestId, taskId);
  }

  finish(requestId: string): void {
    this.taskIds.delete(requestId);
    this.cancelledBeforeTrack.delete(requestId);
  }

  cancel(requestId: string): void {
    const taskId = this.taskIds.get(requestId);
    if (!this.taskIds.has(requestId)) return;
    this.taskIds.delete(requestId);
    if (!taskId) {
      this.cancelledBeforeTrack.add(requestId);
      return;
    }
    this.tasks.cancel(taskId);
  }
}

export function registerDocumentAiHandlers(tasks: GenerationTaskServiceApi): void {
  const activeRequests = new DocumentAiActiveRequests(tasks);
  registerIpcHandler(DOCUMENT_AI_IPC_CHANNELS.ask, async (_event, request: unknown) => {
    if (!isDocumentAiRequest(request)) throw new AppError('INVALID_IPC_REQUEST');
    if (!activeRequests.start(request.requestId)) {
      throw new AppError('CODEX_TURN_ACTIVE');
    }
    try {
      return await askDocumentAi(
        tasks,
        request,
        (taskId) => activeRequests.track(request.requestId, taskId),
      );
    } finally {
      activeRequests.finish(request.requestId);
    }
  });
  registerIpcHandler(DOCUMENT_AI_IPC_CHANNELS.cancel, async (_event, requestId: unknown) => {
    if (!isRequestId(requestId)) throw new AppError('INVALID_IPC_REQUEST');
    activeRequests.cancel(requestId);
  });
}

export function removeDocumentAiHandlers(): void {
  ipcMain.removeHandler(DOCUMENT_AI_IPC_CHANNELS.ask);
  ipcMain.removeHandler(DOCUMENT_AI_IPC_CHANNELS.cancel);
}
