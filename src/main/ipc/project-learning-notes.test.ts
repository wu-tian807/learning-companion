import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import type { ProjectLearningNoteServiceApi } from '../project-learning-notes/project-learning-note-service';
import {
  registerProjectLearningNoteHandlers,
  removeProjectLearningNoteHandlers,
} from './project-learning-notes';

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

function createService() {
  const snapshot = {
    projectId: 'project-1',
    markdown: '# note',
    revision: 1,
    updatedTime: 10,
  } as const;
  const get = vi.fn(() => snapshot);
  const save = vi.fn(() => snapshot);
  return {
    get,
    save,
    service: { get, save } satisfies ProjectLearningNoteServiceApi,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('Project learning note IPC handlers', () => {
  it('forwards validated reads and saves', async () => {
    const { get, save, service } = createService();
    registerProjectLearningNoteHandlers(service);

    await findHandler(IPC_CHANNELS.getProjectLearningNote)({
      projectId: 'project-1',
    });
    await findHandler(IPC_CHANNELS.saveProjectLearningNote)({
      projectId: 'project-1',
      markdown: '# note',
      expectedRevision: 0,
    });

    expect(get).toHaveBeenCalledWith('project-1');
    expect(save).toHaveBeenCalledWith('project-1', '# note', 0);
  });

  it('rejects malformed content before it reaches the service', async () => {
    const { save, service } = createService();
    registerProjectLearningNoteHandlers(service);

    await expect(
      findHandler(IPC_CHANNELS.saveProjectLearningNote)({
        projectId: 'project-1',
        markdown: '# note',
        expectedRevision: -1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(save).not.toHaveBeenCalled();
  });

  it('removes every registered channel', () => {
    removeProjectLearningNoteHandlers();
    expect(electronMocks.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.getProjectLearningNote,
      IPC_CHANNELS.saveProjectLearningNote,
    ]);
  });
});
