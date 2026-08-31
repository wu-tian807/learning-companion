import { ipcMain } from 'electron';

import {
  isConversationRecord,
  type DeleteProjectConversationRequest,
  type ImportProjectConversationsRequest,
  type ProjectConversationProjectRequest,
  type SaveProjectConversationRequest,
} from '../../shared/project-conversations';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { ProjectConversationServiceApi } from '../conversation/project-conversation-service';
import { AppError } from '../errors/app-error';
import { registerIpcHandler } from './register-handler';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProjectRequest(
  value: unknown,
): value is ProjectConversationProjectRequest & Record<string, unknown> {
  return isRecord(value) && typeof value.projectId === 'string';
}

function isSaveRequest(
  value: unknown,
): value is SaveProjectConversationRequest {
  return (
    isRecord(value) &&
    isProjectRequest(value) &&
    isConversationRecord(value.conversation)
  );
}

function isDeleteRequest(
  value: unknown,
): value is DeleteProjectConversationRequest {
  return (
    isRecord(value) &&
    isProjectRequest(value) &&
    typeof value.conversationId === 'string'
  );
}

function isImportRequest(
  value: unknown,
): value is ImportProjectConversationsRequest {
  return (
    isRecord(value) &&
    isProjectRequest(value) &&
    Array.isArray(value.conversations) &&
    value.conversations.every(isConversationRecord)
  );
}

function invalidRequest(): AppError {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerProjectConversationHandlers(
  service: ProjectConversationServiceApi,
): void {
  registerIpcHandler(
    IPC_CHANNELS.listProjectConversations,
    async (_event, request: unknown) => {
      if (!isProjectRequest(request)) throw invalidRequest();
      return service.list(request.projectId);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.saveProjectConversation,
    async (_event, request: unknown) => {
      if (!isSaveRequest(request)) throw invalidRequest();
      return service.save(request.projectId, request.conversation);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.importProjectConversations,
    async (_event, request: unknown) => {
      if (!isImportRequest(request)) throw invalidRequest();
      return service.import(request.projectId, request.conversations);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.deleteProjectConversation,
    async (_event, request: unknown) => {
      if (!isDeleteRequest(request)) throw invalidRequest();
      return service.remove(request.projectId, request.conversationId);
    },
  );
}

export function removeProjectConversationHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.listProjectConversations);
  ipcMain.removeHandler(IPC_CHANNELS.saveProjectConversation);
  ipcMain.removeHandler(IPC_CHANNELS.importProjectConversations);
  ipcMain.removeHandler(IPC_CHANNELS.deleteProjectConversation);
}
