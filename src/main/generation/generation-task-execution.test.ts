import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../errors/app-error';
import type { AnyTaskDefinition } from './contracts/task-definition';
import type { GenerationAgentRunnerResolver } from './generation-agent-runner';
import { GenerationAgentExecutor } from './generation-agent-executor';
import type { GenerationTaskDatabaseApi } from './generation-task-database';
import { GenerationTaskExecution } from './generation-task-execution';
import { GenerationTask } from './generation-task';
import type { GenerationTaskPreparerApi } from './preparation/generation-task-preparer';

describe('GenerationTaskExecution failure persistence', () => {
  it('stores the user-facing policy message and the underlying Codex detail', async () => {
    const update = vi.fn();
    const database = {
      update,
    } as unknown as GenerationTaskDatabaseApi;
    const preparer = {
      prepare: vi.fn(async () => {
        throw new AppError('CODEX_REQUEST_FAILED', {
          cause: new Error(
            'failed to load configuration: invalid transport\nin `mcp_servers.codex_apps`',
          ),
        });
      }),
      restore: vi.fn(),
    } as unknown as GenerationTaskPreparerApi;
    const execution = new GenerationTaskExecution(
      database,
      preparer,
      {} as GenerationAgentExecutor,
      { now: () => 101 },
    );
    const task = GenerationTask.create({
      id: 'task-1',
      projectId: 'project-1',
      definitionId: 'mindmap.generate',
      definitionVersion: 1,
      instruction: { format: 'test', version: 1 },
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
      createdTime: 100,
    });
    const iterator = execution.run(
      task,
      {} as AnyTaskDefinition,
      (() => undefined) as unknown as GenerationAgentRunnerResolver,
      new AbortController().signal,
    );

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'phase', phase: 'prepare', state: 'started' },
    });
    await expect(iterator.next()).rejects.toThrow('CODEX_REQUEST_FAILED');
    expect(task.getSnapshot().failure).toEqual({
      phase: 'prepare',
      failedTime: 101,
      message: 'AI 请求没有完成，请稍后重试。',
      code: 'CODEX_REQUEST_FAILED',
      detail:
        'failed to load configuration: invalid transport\nin `mcp_servers.codex_apps`',
    });
    expect(update).toHaveBeenCalledWith(task.getSnapshot());
  });
});
