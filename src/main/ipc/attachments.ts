import { ipcMain } from 'electron';

import {
  DOCUMENT_QUESTION_TASK_DEFINITION_ID,
  DOCUMENT_QUESTION_TASK_DEFINITION_VERSION,
} from '../../shared/generation-definitions';
import {
  IPC_CHANNELS,
  type DocumentAiRequest,
  type DocumentAiResponse,
} from '../../shared/ipc';
import { isAssetTarget } from '../../shared/workbench/anchor';
import type { AssetAttachment } from '../../shared/workbench/attachment';
import { DocumentQuestionInstruction } from '../../workbenches/document-ai/generation/document-question-instruction';
import type { DocumentQuestionTaskResult } from '../../workbenches/document-ai/generation/document-question-task-definition';
import type { AttachmentServiceApi } from '../attachments/attachment-service';
import { AppError } from '../errors/app-error';
import type { GenerationTaskServiceApi } from '../generation/generation-task-service';
import { registerIpcHandler } from './register-handler';

interface ListAttachmentsRequest {
  readonly projectId: string;
  readonly assetId: string;
}

interface CreateAttachmentRequest {
  readonly projectId: string;
  readonly assetId: string;
  readonly typeId: string;
  readonly typeVersion: number;
  readonly target: AssetAttachment['target'];
  readonly metadata: AssetAttachment['metadata'];
  readonly body?: AssetAttachment['metadata'];
}

interface DeleteAttachmentRequest {
  readonly projectId: string;
  readonly attachmentId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRequest(): AppError {
  return new AppError('INVALID_IPC_REQUEST');
}

function isListAttachmentsRequest(value: unknown): value is ListAttachmentsRequest {
  return isRecord(value) && typeof value.projectId === 'string' && typeof value.assetId === 'string';
}

function isCreateAttachmentRequest(value: unknown): value is CreateAttachmentRequest {
  return (
    isRecord(value) &&
    typeof value.projectId === 'string' &&
    typeof value.assetId === 'string' &&
    typeof value.typeId === 'string' &&
    Number.isSafeInteger(value.typeVersion) &&
    typeof value.typeVersion === 'number' &&
    value.typeVersion > 0 &&
    isAssetTarget(value.target) &&
    isRecord(value.metadata)
    && (value.body === undefined || isRecord(value.body))
  );
}

function isDeleteAttachmentRequest(value: unknown): value is DeleteAttachmentRequest {
  return isRecord(value) && typeof value.projectId === 'string' && typeof value.attachmentId === 'string';
}

function isDocumentAiRequest(value: unknown): value is DocumentAiRequest {
  return (
    isRecord(value) &&
    typeof value.projectId === 'string' &&
    value.projectId.trim().length > 0 &&
    typeof value.assetId === 'string' &&
    value.assetId.trim().length > 0 &&
    typeof value.question === 'string' &&
    value.question.trim().length > 0 &&
    isAssetTarget(value.target) &&
    (value.selectedText === undefined || typeof value.selectedText === 'string') &&
    (value.selectedImageDataUrl === undefined ||
      (typeof value.selectedImageDataUrl === 'string' &&
        /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(value.selectedImageDataUrl) &&
        value.selectedImageDataUrl.length <= 12_000_000))
  );
}

async function askDocumentAi(
  tasks: GenerationTaskServiceApi,
  request: DocumentAiRequest,
): Promise<DocumentAiResponse> {
  const instruction = new DocumentQuestionInstruction({
    question: request.question,
    target: request.target,
    ...(request.selectedText ? { selectedText: request.selectedText } : {}),
  });
  const created = tasks.create({
    projectId: request.projectId.trim(),
    definitionId: DOCUMENT_QUESTION_TASK_DEFINITION_ID,
    definitionVersion: DOCUMENT_QUESTION_TASK_DEFINITION_VERSION,
    instruction: instruction.toSnapshot(),
    assetReferences: {
      document: [{ assetId: request.assetId.trim() }],
    },
  });
  const run = tasks.run(created.id);
  let next = await run.next();

  while (!next.done) {
    next = await run.next();
  }

  const result = next.value.result as DocumentQuestionTaskResult;
  if (
    typeof result.answer !== 'string' ||
    typeof result.providerId !== 'string' ||
    typeof result.modelId !== 'string'
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return result;
}

export function registerAttachmentHandlers(
  service: AttachmentServiceApi,
  tasks: GenerationTaskServiceApi,
): void {
  registerIpcHandler(IPC_CHANNELS.listAttachments, async (_event, request: unknown) => {
    if (!isListAttachmentsRequest(request)) throw invalidRequest();
    return service.listByAsset(request.projectId, request.assetId);
  });

  registerIpcHandler(IPC_CHANNELS.createAttachment, async (_event, request: unknown) => {
    if (!isCreateAttachmentRequest(request)) throw invalidRequest();
    return service.create({
      projectId: request.projectId,
      assetId: request.assetId,
      typeId: request.typeId,
      typeVersion: request.typeVersion,
      target: request.target,
      metadata: request.metadata as AssetAttachment['metadata'],
      body: request.body,
    });
  });

  registerIpcHandler(IPC_CHANNELS.readAttachmentContent, async (_event, request: unknown) => {
    if (!isDeleteAttachmentRequest(request)) throw invalidRequest();
    return service.readContent(request.projectId, request.attachmentId);
  });

  registerIpcHandler(IPC_CHANNELS.deleteAttachment, async (_event, request: unknown) => {
    if (!isDeleteAttachmentRequest(request)) throw invalidRequest();
    await service.delete(request.projectId, request.attachmentId);
  });

  registerIpcHandler(IPC_CHANNELS.askDocumentAi, async (_event, request: unknown) => {
    if (!isDocumentAiRequest(request)) throw invalidRequest();
    return askDocumentAi(tasks, request);
  });
}

export function removeAttachmentHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.listAttachments);
  ipcMain.removeHandler(IPC_CHANNELS.createAttachment);
  ipcMain.removeHandler(IPC_CHANNELS.readAttachmentContent);
  ipcMain.removeHandler(IPC_CHANNELS.deleteAttachment);
  ipcMain.removeHandler(IPC_CHANNELS.askDocumentAi);
}
