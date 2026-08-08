import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MIND_MAP_GENERATION_INSTRUCTION_FORMAT,
  MIND_MAP_GENERATION_INSTRUCTION_VERSION,
  MIND_MAP_GENERATION_TASK_DEFINITION_ID,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
} from '../../shared/generation-definitions';
import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import { GenerationTask } from '../generation/generation-task';
import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
} from '../generation/generation-task-service';
import {
  registerGenerationTaskHandlers,
  removeGenerationTaskHandlers,
} from './generation-tasks';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

type RegisteredIpcHandler = (event: unknown, request?: unknown) => unknown;

function findHandler(channel: string) {
  const registration = electronMocks.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );

  if (!registration) {
    throw new Error(`找不到 ${channel} handler`);
  }

  const handler = registration[1] as RegisteredIpcHandler;
  return async (request?: unknown) => {
    const result = await handler({}, request);

    if (!isIpcResult<unknown>(result)) {
      throw new Error('IPC 测试响应无效');
    }
    if (!result.ok) {
      throw result.error;
    }
    return result.data;
  };
}

function createSnapshot() {
  return GenerationTask.create({
    id: 'task-1',
    projectId: 'project-1',
    definitionId: MIND_MAP_GENERATION_TASK_DEFINITION_ID,
    definitionVersion: MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
    instruction: {
      format: MIND_MAP_GENERATION_INSTRUCTION_FORMAT,
      version: MIND_MAP_GENERATION_INSTRUCTION_VERSION,
    },
    assetReferences: { sources: [{ assetId: 'asset-1' }] },
    createdTime: 10,
  }).getSnapshot();
}

function createService() {
  const snapshot = createSnapshot();
  let listener:
    | ((event: GenerationTaskServiceEvent) => void)
    | undefined;
  const service = {
    getActiveProjectId: vi.fn(() => 'project-1'),
    list: vi.fn(() => [snapshot]),
    start: vi.fn(() => snapshot),
    retry: vi.fn(() => snapshot),
    cancel: vi.fn(),
    discard: vi.fn(),
    subscribe: vi.fn((nextListener) => {
      listener = nextListener;
      return vi.fn();
    }),
  } as unknown as GenerationTaskServiceApi;

  return { service, snapshot, emit: (event: GenerationTaskServiceEvent) => listener?.(event) };
}

beforeEach(() => {
  removeGenerationTaskHandlers();
  vi.clearAllMocks();
});

describe('GenerationTask IPC handlers', () => {
  it('starts a generic task and returns its public view', async () => {
    const { service } = createService();
    registerGenerationTaskHandlers(service);
    const request = {
      projectId: 'project-1',
      definitionId: MIND_MAP_GENERATION_TASK_DEFINITION_ID,
      definitionVersion: MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
      instruction: {
        format: MIND_MAP_GENERATION_INSTRUCTION_FORMAT,
        version: MIND_MAP_GENERATION_INSTRUCTION_VERSION,
      },
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
    };

    await expect(
      findHandler(IPC_CHANNELS.startGenerationTask)(request),
    ).resolves.toMatchObject({
      id: 'task-1',
      projectId: 'project-1',
      status: 'created',
      metrics: { agentExecutions: [], totalActiveDurationMs: 0 },
    });
    expect(service.start).toHaveBeenCalledWith(request);
  });

  it('rejects invalid input and a stale Project context', async () => {
    const { service } = createService();
    registerGenerationTaskHandlers(service);

    await expect(
      findHandler(IPC_CHANNELS.startGenerationTask)({ projectId: 'project-1' }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.listGenerationTasks)({
        projectId: 'project-2',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_CONTEXT_CHANGED' });
  });

  it('forwards retry, cancel, and discard to the active Project service', async () => {
    const { service } = createService();
    registerGenerationTaskHandlers(service);
    const request = { projectId: 'project-1', taskId: 'task-1' };

    await findHandler(IPC_CHANNELS.retryGenerationTask)(request);
    await findHandler(IPC_CHANNELS.cancelGenerationTask)(request);
    await findHandler(IPC_CHANNELS.discardGenerationTask)(request);

    expect(service.retry).toHaveBeenCalledWith('task-1');
    expect(service.cancel).toHaveBeenCalledWith('task-1');
    expect(service.discard).toHaveBeenCalledWith('task-1');
  });

  it('broadcasts public task events and unwraps Provider execution events', () => {
    const { service, snapshot, emit } = createService();
    const broadcast = vi.fn();
    registerGenerationTaskHandlers(service, { broadcast });

    emit({ type: 'task-changed', snapshot });
    emit({
      type: 'execution-event',
      projectId: 'project-1',
      taskId: 'task-1',
      event: {
        type: 'agent-event',
        event: { type: 'assistant-delta', delta: '正在生成' },
      },
    });

    expect(broadcast).toHaveBeenNthCalledWith(
      1,
      IPC_CHANNELS.generationTaskChanged,
      expect.objectContaining({
        type: 'task-changed',
        snapshot: expect.objectContaining({ id: 'task-1' }),
      }),
    );
    expect(broadcast).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.generationTaskChanged,
      {
        type: 'execution-event',
        projectId: 'project-1',
        taskId: 'task-1',
        event: { type: 'assistant-delta', delta: '正在生成' },
      },
    );
  });
});
