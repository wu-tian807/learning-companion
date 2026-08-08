import { describe, expect, it } from 'vitest';

import { GenerationTask } from './generation-task';

function createTask(): GenerationTask {
  return GenerationTask.create({
    id: 'task-1',
    projectId: 'project-1',
    definitionId: 'mindmap.generate',
    definitionVersion: 1,
    instruction: { format: 'test', version: 1 },
    assetReferences: { sources: [{ assetId: 'asset-1' }] },
    createdTime: 100,
  });
}

describe('GenerationTask', () => {
  it('keeps a user message and diagnostic detail for failed tasks', () => {
    const task = createTask();

    task.recordFailure({
      phase: 'agent',
      failedTime: 101,
      message: 'AI 请求没有完成，请稍后重试。',
      code: 'CODEX_REQUEST_FAILED',
      detail: 'failed to load configuration: invalid transport',
    });

    expect(task.getSnapshot().failure).toEqual({
      phase: 'agent',
      failedTime: 101,
      message: 'AI 请求没有完成，请稍后重试。',
      code: 'CODEX_REQUEST_FAILED',
      detail: 'failed to load configuration: invalid transport',
    });
  });

  it('records resumable checkpoints and actual Agent execution metrics', () => {
    const task = createTask();

    task.recordPrepared({
      checkpoint: {
        completedTime: 110,
        manifestRef: 'control/prepared-manifest.json',
      },
      durationMs: 10,
      updatedTime: 110,
    });
    task.assignProvider('codex', 111);
    expect(task.getStatus()).toBe('agent-assigned');
    task.recordAgentCompleted({
      checkpoint: {
        completedTime: 140,
        sessionId: 'session-1',
      },
      metrics: {
        sessionId: 'session-1',
        providerId: 'codex',
        modelId: 'gpt-5.2',
        startedTime: 112,
        completedTime: 138,
        activeDurationMs: 26,
        turnCount: 2,
        repairTurnCount: 1,
        usage: {
          inputTokens: 120,
          cachedInputTokens: 80,
          outputTokens: 40,
          totalTokens: 160,
        },
      },
      updatedTime: 140,
    });
    task.recordPostProcessed({
      checkpoint: {
        completedTime: 145,
        result: { resultAssetId: 'mindmap-1' },
      },
      durationMs: 5,
      updatedTime: 145,
    });

    const snapshot = task.getSnapshot();
    expect(task.getStatus()).toBe('post-processed');
    expect(snapshot.assignedProviderId).toBe('codex');
    expect(snapshot.agentCompleted?.sessionId).toBe('session-1');
    expect(snapshot.metrics).toMatchObject({
      prepareDurationMs: 10,
      postProcessDurationMs: 5,
      totalActiveDurationMs: 41,
      totalUsage: {
        inputTokens: 120,
        cachedInputTokens: 80,
        outputTokens: 40,
        totalTokens: 160,
      },
    });
    expect(snapshot.metrics.agentExecutions).toHaveLength(1);
  });

  it('allows prepare recovery before Agent execution but not afterward', () => {
    const task = createTask();

    task.recordPrepared({
      checkpoint: { completedTime: 105, manifestRef: 'control/old.json' },
      durationMs: 5,
      updatedTime: 105,
    });
    task.recordFailure({
      phase: 'agent',
      failedTime: 106,
      message: 'interrupted',
    });
    task.recordPrepared({
      checkpoint: { completedTime: 110, manifestRef: 'control/new.json' },
      durationMs: 4,
      updatedTime: 110,
    });

    expect(task.getSnapshot().prepared?.manifestRef).toBe(
      'control/new.json',
    );
    expect(task.getSnapshot().failure).toBeUndefined();
    expect(task.getSnapshot().metrics.prepareDurationMs).toBe(4);
  });

  it('rejects checkpoints that skip required phases', () => {
    const task = createTask();

    expect(() =>
      task.recordAgentCompleted({
        checkpoint: {
          completedTime: 110,
          sessionId: 'session',
        },
        metrics: {
          sessionId: 'session',
          providerId: 'codex',
          modelId: 'model',
          startedTime: 100,
          completedTime: 110,
          activeDurationMs: 10,
          turnCount: 1,
          repairTurnCount: 0,
        },
        updatedTime: 110,
      }),
    ).toThrow('checkpoint 顺序无效');
  });

  it('pins the first assigned Provider and rejects a later switch', () => {
    const task = createTask();
    task.recordPrepared({
      checkpoint: {
        completedTime: 105,
        manifestRef: 'control/prepared-manifest.json',
      },
      durationMs: 5,
      updatedTime: 105,
    });

    task.assignProvider('codex', 106);
    task.assignProvider('codex', 107);

    expect(task.getSnapshot().assignedProviderId).toBe('codex');
    expect(task.getSnapshot().updatedTime).toBe(106);
    expect(() => task.assignProvider('claude-code', 108)).toThrow(
      '已固定到其他 Provider',
    );
  });
});
