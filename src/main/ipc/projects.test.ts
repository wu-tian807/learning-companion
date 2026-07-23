import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { ProjectDatabaseApi } from '../projects/project-database';
import { createProjectSnapshot } from '../projects/project';
import { registerProjectHandlers, removeProjectHandlers } from './projects';

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

type IpcHandler = (event: unknown, request?: unknown) => unknown;

function findHandler(channel: string): IpcHandler {
  const registration = electronMocks.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );

  if (!registration) {
    throw new Error(`找不到 ${channel} handler`);
  }

  return registration[1] as IpcHandler;
}

function createDatabase() {
  const project = createProjectSnapshot({
    id: 'project-1',
    name: '机器学习',
    icon: '🤖',
    createdTime: new Date('2026-07-23T02:00:00.000Z'),
  });
  const list = vi.fn(() => [project]);
  const add = vi.fn(() => project);
  const update = vi.fn(() => project);
  const deleteProject = vi.fn();
  const database: ProjectDatabaseApi = {
    initialize: vi.fn(),
    list,
    get: vi.fn(() => project),
    add,
    update,
    delete: deleteProject,
  };

  return { add, database, deleteProject, list, update };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Project IPC handlers', () => {
  it('maps in-memory Projects to serializable summaries', () => {
    const { database, list } = createDatabase();
    registerProjectHandlers(database);

    const result = findHandler(IPC_CHANNELS.listProjects)({});

    expect(result).toEqual([
      {
        id: 'project-1',
        name: '机器学习',
        icon: '🤖',
        createdTime: '2026-07-23T02:00:00.000Z',
        sources: [],
        pinned: false,
      },
    ]);
    expect(list).toHaveBeenCalledOnce();
  });

  it('forwards explicit mutation requests to the composed database API', () => {
    const { add, database, deleteProject, update } = createDatabase();
    registerProjectHandlers(database);

    findHandler(IPC_CHANNELS.createProject)({}, { name: '新 Project' });
    findHandler(IPC_CHANNELS.renameProject)(
      {},
      { id: 'project-1', name: '新标题' },
    );
    findHandler(IPC_CHANNELS.setProjectPinned)(
      {},
      { id: 'project-1', pinned: true },
    );
    findHandler(IPC_CHANNELS.deleteProject)({}, { id: 'project-1' });

    expect(add).toHaveBeenCalledWith({ name: '新 Project' });
    expect(update).toHaveBeenNthCalledWith(1, 'project-1', { name: '新标题' });
    expect(update).toHaveBeenNthCalledWith(2, 'project-1', { pinned: true });
    expect(deleteProject).toHaveBeenCalledWith('project-1');
  });

  it('rejects malformed mutations before they reach ProjectDatabase', () => {
    const { add, database } = createDatabase();
    registerProjectHandlers(database);

    expect(() =>
      findHandler(IPC_CHANNELS.createProject)({}, { name: '' }),
    ).toThrow('Project 创建请求无效');
    expect(add).not.toHaveBeenCalled();
  });

  it('removes every Project handler', () => {
    removeProjectHandlers();

    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.listProjects,
    );
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.createProject,
    );
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.renameProject,
    );
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.setProjectPinned,
    );
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.deleteProject,
    );
  });
});
