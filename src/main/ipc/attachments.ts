import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';
import { isAssetTarget } from '../../shared/workbench/asset-target';
import type { AssetAttachment } from '../../shared/attachments/contracts';
import { isJsonValue } from '../../shared/workbench/protocol';
import type { AttachmentServiceApi } from '../attachments/attachment-service';
import { AppError } from '../errors/app-error';
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

export function registerAttachmentHandlers(
  service: AttachmentServiceApi,
): void {
  registerIpcHandler(IPC_CHANNELS.listAttachments, async (_event, request: unknown) => {
    if (!isListAttachmentsRequest(request)) throw invalidRequest();
    return service.listByAsset(request.projectId, request.assetId);
  });

  registerIpcHandler(IPC_CHANNELS.createAttachment, async (_event, request: unknown) => {
    if (!isCreateAttachmentRequest(request)) throw invalidRequest();
    const input = {
      projectId: request.projectId,
      assetId: request.assetId,
      typeId: request.typeId,
      typeVersion: request.typeVersion,
      target: request.target,
      metadata: request.metadata as AssetAttachment['metadata'],
    };
    return request.body
      ? service.createWithContent({
          ...input,
          content: {
            fileName: 'annotation.json',
            mediaType: 'application/json',
            data: `${JSON.stringify(request.body, undefined, 2)}\n`,
          },
        })
      : service.create(input);
  });

  registerIpcHandler(IPC_CHANNELS.readAttachmentContent, async (_event, request: unknown) => {
    if (!isDeleteAttachmentRequest(request)) throw invalidRequest();
    const content = await service.readTextContent(
      request.projectId,
      request.attachmentId,
    );
    if (content === undefined) {
      throw new AppError('ATTACHMENT_NOT_FOUND');
    }
    const parsed: unknown = JSON.parse(content);
    if (!isJsonValue(parsed)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    return parsed;
  });

  registerIpcHandler(IPC_CHANNELS.deleteAttachment, async (_event, request: unknown) => {
    if (!isDeleteAttachmentRequest(request)) throw invalidRequest();
    await service.delete(request.projectId, request.attachmentId);
  });

}

export function removeAttachmentHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.listAttachments);
  ipcMain.removeHandler(IPC_CHANNELS.createAttachment);
  ipcMain.removeHandler(IPC_CHANNELS.readAttachmentContent);
  ipcMain.removeHandler(IPC_CHANNELS.deleteAttachment);
}
