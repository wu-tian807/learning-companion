import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationRecord } from '../../shared/project-conversations';
import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import type { ProjectConversationServiceApi } from '../conversation/project-conversation-service';
import {
  registerProjectConversationHandlers,
  removeProjectConversationHandlers,
} from './project-conversations';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}));

type RegisteredIpcHandler = (event: unknown, request?: unknown) => unknown;

function findHandler(channel: string) {
  const registration = electronMocks.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );
  if (!registration) throw new Error(`找不到 ${channel} handler`);
  const handler = registration[1] as RegisteredIpcHandler;
  return async (request: unknown) => {
    const result = await handler({}, request);
    if (!isIpcResult<unknown>(result)) throw new Error('IPC 测试响应无效');
    if (!result.ok) throw result.error;
    return result.data;
  };
}

function record(): ConversationRecord {
  return {
    id: 'conversation-1',
    title: '测试对话',
    messages: [
      { id: 'question-1', role: 'user', text: '问题', createdTime: 1 },
    ],
    createdTime: 1,
    updatedTime: 1,
  };
}

function createService() {
  const list = vi.fn(() => [record()]);
  const save = vi.fn(() => [record()]);
  const importRecords = vi.fn(() => [record()]);
  const remove = vi.fn(() => []);
  return {
    list,
    save,
    importRecords,
    remove,
    service: {
      list,
      save,
      import: importRecords,
      remove,
    } satisfies ProjectConversationServiceApi,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Project Conversation IPC handlers', () => {
  it('forwards validated Project conversation operations to the backend service', async () => {
    const { importRecords, list, remove, save, service } = createService();
    registerProjectConversationHandlers(service);

    await findHandler(IPC_CHANNELS.listProjectConversations)({
      projectId: 'project-1',
    });
    await findHandler(IPC_CHANNELS.saveProjectConversation)({
      projectId: 'project-1',
      conversation: record(),
    });
    await findHandler(IPC_CHANNELS.importProjectConversations)({
      projectId: 'project-1',
      conversations: [record()],
    });
    await findHandler(IPC_CHANNELS.deleteProjectConversation)({
      projectId: 'project-1',
      conversationId: 'conversation-1',
    });

    expect(list).toHaveBeenCalledWith('project-1');
    expect(save).toHaveBeenCalledWith('project-1', record());
    expect(importRecords).toHaveBeenCalledWith('project-1', [record()]);
    expect(remove).toHaveBeenCalledWith('project-1', 'conversation-1');
  });

  it('rejects malformed records before they reach the service', async () => {
    const { save, service } = createService();
    registerProjectConversationHandlers(service);

    await expect(
      findHandler(IPC_CHANNELS.saveProjectConversation)({
        projectId: 'project-1',
        conversation: { ...record(), title: '' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(save).not.toHaveBeenCalled();
  });

  it('removes every registered channel', () => {
    removeProjectConversationHandlers();

    expect(electronMocks.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.listProjectConversations,
      IPC_CHANNELS.saveProjectConversation,
      IPC_CHANNELS.importProjectConversations,
      IPC_CHANNELS.deleteProjectConversation,
    ]);
  });
});
