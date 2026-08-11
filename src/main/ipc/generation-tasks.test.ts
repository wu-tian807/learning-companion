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
import { createTextAgentUserMessage } from '../generation/contracts/agent-message';
import { GenerationAgentExecutor } from '../generation/generation-agent-executor';
import type { GenerationAgentRunnerResolver } from '../generation/generation-agent-runner';
import type { GenerationTaskDatabaseApi } from '../generation/generation-task-database';
import { GenerationTaskDefinitionRegistry } from '../generation/generation-task-definition-registry';
import { GenerationTaskExecution } from '../generation/generation-task-execution';
import { GenerationTaskService } from '../generation/generation-task-service';
import type { GenerationTaskPreparerApi } from '../generation/preparation/generation-task-preparer';
import type { PreparedGenerationTask } from '../generation/preparation/prepared-generation-task';
import { HtmlAssistantInstruction } from '../../workbenches/html/generation/html-assistant-instruction';
import { createHtmlAssistantProcessor } from '../../workbenches/html/generation/html-assistant-processor';
import { createHtmlAssistantTaskDefinitionV1 } from '../../workbenches/html/generation/html-assistant-task-definition';
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

function findHandler<T = unknown>(channel: string) {
  const registration = electronMocks.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );

  if (!registration) {
    throw new Error(`找不到 ${channel} handler`);
  }

  const handler = registration[1] as RegisteredIpcHandler;
  return async (request?: unknown): Promise<T> => {
    const result = await handler({}, request);

    if (!isIpcResult<unknown>(result)) {
      throw new Error('IPC 测试响应无效');
    }
    if (!result.ok) {
      throw result.error;
    }
    return result.data as T;
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
    get: vi.fn(() => snapshot),
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

  it('reads a completed task by id even after the service releases it from memory', async () => {
    const { service } = createService();
    registerGenerationTaskHandlers(service);

    await expect(
      findHandler(IPC_CHANNELS.getGenerationTask)({
        projectId: 'project-1',
        taskId: 'task-1',
      }),
    ).resolves.toMatchObject({ id: 'task-1' });
    expect(service.get).toHaveBeenCalledWith('task-1');
  });

  it('real Service + IPC returns a completed snapshot released from memory', async () => {
    const definition = createHtmlAssistantTaskDefinitionV1(createHtmlAssistantProcessor());
    const registry = new GenerationTaskDefinitionRegistry();
    registry.register(definition);
    const completed = new Map<string, unknown>();
    const database: GenerationTaskDatabaseApi = {
      get: (taskId) => completed.get(taskId) as never,
      listByProject: () => [],
      listUnfinishedByProject: () => [],
      create: (task) => { completed.set(task.id, task); },
      update: (task) => { completed.set(task.id, task); },
      delete: (taskId) => { completed.delete(taskId); },
    };
    const runnerResolver: GenerationAgentRunnerResolver = {
      resolveSelectorConfiguration() {
        return { providerId: 'codex', connectionId: 'codex-account' };
      },
      async resolveRunner() {
        return {
          providerId: 'codex',
          connectionId: 'codex-account',
          async *runTurn() {
            yield* [] as never[];
            return {
              sessionId: 'session-1',
              providerId: 'codex',
              connectionId: 'codex-account',
              modelId: 'model-1',
              startedTime: 1,
              completedTime: 2,
              activeDurationMs: 1,
              assistantOutput: 'answer',
            };
          },
        };
      },
    };
    const createPrepared = (task: { id: string; projectId: string }, definition: ReturnType<typeof createHtmlAssistantTaskDefinitionV1>): PreparedGenerationTask => ({
      taskId: task.id,
      projectId: task.projectId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      providerSelectorId: definition.providerSelectorId,
      outputMode: 'assistant-message',
      instruction: new HtmlAssistantInstruction({ conversationId: 'conversation-1', question: 'question' }),
      systemInstruction: definition.systemInstruction,
      defaultUserMessage: createTextAgentUserMessage('question'),
      toolRequirements: [],
      skills: [],
      mcpServers: [],
      workspaces: {
        primary: { ...definition.primaryWorkspaceConfig, instanceKey: 'conversation-1', path: '/tmp/html-assistant' },
        secondary: [],
      },
      assetReferences: { sources: [{ alias: 'sources-0001', assetId: 'asset-1', name: 'index.html', mediaType: 'text/html', contentRevision: 'r1', relativePath: 'references/sources-0001/source.html' }] },
      manifestRef: 'control/prepared-manifest.json',
    });
    const preparer: GenerationTaskPreparerApi = {
      async prepare(task) { return createPrepared(task, definition); },
      async restore(task) { return createPrepared(task, definition); },
    };
    const service = new GenerationTaskService(
      database,
      registry,
      new GenerationTaskExecution(database, preparer, new GenerationAgentExecutor()),
      { get: () => ({ id: 'project-1', name: 'Project', icon: 'book', createdTime: 1, pinned: false, workspacePath: '/tmp' }) },
      runnerResolver,
      { createId: () => 'task-1' },
    );
    service.loadFromProject('project-1');
    registerGenerationTaskHandlers(service);

    const started = await findHandler<{ id: string }>(IPC_CHANNELS.startGenerationTask)({
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new HtmlAssistantInstruction({ conversationId: 'conversation-1', question: 'question' }).toSnapshot(),
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
    });

    await vi.waitFor(() => {
      const task = database.get('task-1') as { completed?: unknown } | undefined;
      if (!task?.completed) throw new Error('not completed yet');
    });
    expect(service.list()).toEqual([]);
    await expect(
      findHandler(IPC_CHANNELS.getGenerationTask)({
        projectId: 'project-1',
        taskId: started.id,
      }),
    ).resolves.toMatchObject({ id: 'task-1', status: 'completed', result: { answer: 'answer' } });
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
    await expect(
      findHandler(IPC_CHANNELS.getGenerationTask)({
        projectId: 'project-2',
        taskId: 'task-1',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_CONTEXT_CHANGED' });
    await expect(
      findHandler(IPC_CHANNELS.getGenerationTask)({
        projectId: 'project-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
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

  it('rejects retry/cancel/discard with a stale or unknown Project context', async () => {
    const { service } = createService();
    registerGenerationTaskHandlers(service);

    // 陈旧 project：拒绝且不触碰 service
    await expect(
      findHandler(IPC_CHANNELS.retryGenerationTask)({
        projectId: 'project-2',
        taskId: 'task-1',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_CONTEXT_CHANGED' });
    await expect(
      findHandler(IPC_CHANNELS.cancelGenerationTask)({
        projectId: 'project-2',
        taskId: 'task-1',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_CONTEXT_CHANGED' });
    await expect(
      findHandler(IPC_CHANNELS.discardGenerationTask)({
        projectId: 'project-2',
        taskId: 'task-1',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_CONTEXT_CHANGED' });
    expect(service.retry).not.toHaveBeenCalled();
    expect(service.cancel).not.toHaveBeenCalled();
    expect(service.discard).not.toHaveBeenCalled();

    // 畸形请求（缺 taskId / 非对象）：INVALID_IPC_REQUEST
    await expect(
      findHandler(IPC_CHANNELS.retryGenerationTask)({
        projectId: 'project-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await expect(
      findHandler(IPC_CHANNELS.retryGenerationTask)(null),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(service.retry).not.toHaveBeenCalled();
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
