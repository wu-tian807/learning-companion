import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import { createProjectSnapshot } from '../projects/project';
import type { ProjectServiceApi } from '../projects/project-service';
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

type RegisteredIpcHandler = (event: unknown, request?: unknown) => unknown;
type IpcHandler = (event: unknown, request?: unknown) => Promise<unknown>;

function findHandler(channel: string): IpcHandler {
  const registration = electronMocks.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );

  if (!registration) {
    throw new Error(`找不到 ${channel} handler`);
  }

  const handler = registration[1] as RegisteredIpcHandler;

  return async (event, request) => {
    const result = await handler(event, request);
    if (!isIpcResult<unknown>(result)) {
      throw new Error('IPC 测试响应无效');
    }
    if (!result.ok) {
      throw result.error;
    }
    return result.data;
  };
}

function createService() {
  const project = createProjectSnapshot({
    id: 'project-1',
    name: '机器学习',
    icon: '🤖',
    createdTime: Date.parse('2026-07-23T02:00:00.000Z'),
  });
  const snapshot = { ...project, assetCount: 3 };
  const listProjects = vi.fn(() => [snapshot]);
  const createProject = vi.fn(() => snapshot);
  const renameProject = vi.fn(() => snapshot);
  const setProjectPinned = vi.fn(() => snapshot);
  const deleteProject = vi.fn();
  const projectService = {
    listProjects,
    createProject,
    renameProject,
    setProjectPinned,
    deleteProject,
  } as unknown as ProjectServiceApi;

  return {
    createProject,
    deleteProject,
    listProjects,
    projectService,
    renameProject,
    setProjectPinned,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Project IPC handlers', () => {
  it('maps in-memory Projects to serializable summaries', async () => {
    const { listProjects, projectService } = createService();
    registerProjectHandlers(projectService);

    const result = await findHandler(IPC_CHANNELS.listProjects)({});

    expect(result).toEqual([
      {
        id: 'project-1',
        name: '机器学习',
        icon: '🤖',
        createdTime: Date.parse('2026-07-23T02:00:00.000Z'),
        assetCount: 3,
        pinned: false,
      },
    ]);
    expect(listProjects).toHaveBeenCalledOnce();
  });

  it('forwards explicit mutation requests only to ProjectService', async () => {
    const {
      createProject,
      deleteProject,
      projectService,
      renameProject,
      setProjectPinned,
    } = createService();
    registerProjectHandlers(projectService);

    await findHandler(IPC_CHANNELS.createProject)({}, { name: '新 Project' });
    await findHandler(IPC_CHANNELS.renameProject)(
      {},
      { id: 'project-1', name: '新标题' },
    );
    await findHandler(IPC_CHANNELS.setProjectPinned)(
      {},
      { id: 'project-1', pinned: true },
    );
    await findHandler(IPC_CHANNELS.deleteProject)({}, { id: 'project-1' });

    expect(createProject).toHaveBeenCalledWith({ name: '新 Project' });
    expect(renameProject).toHaveBeenCalledWith('project-1', '新标题');
    expect(setProjectPinned).toHaveBeenCalledWith('project-1', true);
    expect(deleteProject).toHaveBeenCalledWith('project-1');
  });

  it('rejects malformed mutations before they reach ProjectService', async () => {
    const { createProject, projectService } = createService();
    registerProjectHandlers(projectService);

    await expect(
      findHandler(IPC_CHANNELS.createProject)({}, { name: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(createProject).not.toHaveBeenCalled();
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
