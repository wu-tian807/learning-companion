import { describe, expect, it, vi } from 'vitest';

import { createTextAgentUserMessage } from './contracts/agent-message';
import { GenerationAgentExecutor } from './generation-agent-executor';
import type {
  GenerationAgentRunner,
  GenerationAgentTurnRequest,
} from './generation-agent-runner';
import { GenerationTaskAgentSession } from './generation-task-agent-session';
import type { GenerationTaskDatabaseApi } from './generation-task-database';
import { GenerationTask } from './generation-task';
import type { PreparedGenerationTask } from './preparation/prepared-generation-task';

describe('GenerationTaskAgentSession', () => {
  it('keeps multiple logical calls on one session and replays checkpoints', async () => {
    const task = GenerationTask.create({
      id: 'task-1',
      projectId: 'project-1',
      definitionId: 'mindmap.generate',
      definitionVersion: 1,
      instruction: { format: 'test', version: 1 },
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
      createdTime: 1,
    });
    task.recordPrepared({
      checkpoint: {
        completedTime: 2,
        manifestRef: 'control/prepared-manifest.json',
      },
      durationMs: 1,
      updatedTime: 2,
    });
    const prepared: PreparedGenerationTask = {
      taskId: 'task-1',
      projectId: 'project-1',
      definitionId: 'mindmap.generate',
      definitionVersion: 1,
      providerSelectorId: 'generation-center',
      outputMode: 'workspace-artifact',
      instruction: {
        toSnapshot: () => null,
        toUserMessage: () => createTextAgentUserMessage('generate'),
      },
      systemInstruction: 'Generate a candidate.',
      defaultUserMessage: createTextAgentUserMessage('generate'),
      toolRequirements: [],
      skills: [],
      mcpServers: [],
      workspaces: {
        primary: {
          key: 'generation-mindmap',
          scope: 'task',
          permissions: { read: true, write: true },
          instanceKey: 'task-1',
          path: 'D:\\tmp\\task-1',
        },
        secondary: [],
      },
      assetReferences: { sources: [] },
      manifestRef: 'control/prepared-manifest.json',
    };
    const updates: unknown[] = [];
    const database = {
      update(snapshot) {
        updates.push(snapshot);
      },
    } as GenerationTaskDatabaseApi;
    const requests: GenerationAgentTurnRequest[] = [];
    let turnNumber = 0;
    const runner: GenerationAgentRunner = {
      providerId: 'codex',
      connectionId: 'codex-account',
      async *runTurn(request) {
        yield* [] as never[];
        requests.push(request);
        turnNumber += 1;
        return {
          sessionId: 'session-1',
          providerId: 'codex',
          connectionId: 'codex-account',
          modelId: 'gpt-test',
          providerExecutionId: `turn-${turnNumber}`,
          startedTime: turnNumber * 10,
          completedTime: turnNumber * 10 + 5,
          activeDurationMs: 5,
          assistantOutput: `answer-${turnNumber}`,
          usage: { totalTokens: 10 },
        };
      },
    };
    const resolveRunner = vi.fn(async () => runner);
    let checkpointTime = 20;
    const session = new GenerationTaskAgentSession(
      task,
      prepared,
      database,
      new GenerationAgentExecutor(),
      {
        resolveSelectorConfiguration: () => ({
          providerId: 'codex',
          connectionId: 'codex-account',
        }),
        resolveRunner,
      },
      new AbortController().signal,
      {
        now: () => checkpointTime++,
        emit: vi.fn(),
      },
    );

    const generated = await session.call({
      callKey: 'generate',
      purpose: 'generation',
    });
    await session.call({
      callKey: 'repair-1',
      purpose: 'repair',
      userMessage: createTextAgentUserMessage('repair it'),
    });

    expect(resolveRunner).toHaveBeenCalledOnce();
    expect(generated.assistantOutput).toBe('answer-1');
    expect(requests.map(({ callKey, sessionId }) => ({ callKey, sessionId })))
      .toEqual([
        { callKey: 'generate', sessionId: undefined },
        { callKey: 'repair-1', sessionId: 'session-1' },
      ]);
    expect(task.getSnapshot()).toMatchObject({
      assignedProviderId: 'codex',
      assignedConnectionId: 'codex-account',
      agentCalls: [
        { callKey: 'generate', purpose: 'generation', sessionId: 'session-1' },
        { callKey: 'repair-1', purpose: 'repair', sessionId: 'session-1' },
      ],
      metrics: {
        totalUsage: { totalTokens: 20 },
      },
    });
    expect(updates.length).toBeGreaterThanOrEqual(3);

    const recoveredResolver = vi.fn(async () => {
      throw new Error('Provider should not run for a completed call');
    });
    const recovered = new GenerationTaskAgentSession(
      task,
      prepared,
      database,
      new GenerationAgentExecutor(),
      {
        resolveSelectorConfiguration: () => ({
          providerId: 'codex',
          connectionId: 'codex-account',
        }),
        resolveRunner: recoveredResolver,
      },
      new AbortController().signal,
      { now: () => 100, emit: vi.fn() },
    );

    await expect(
      recovered.call({ callKey: 'repair-1', purpose: 'repair' }),
    ).resolves.toMatchObject({
      callKey: 'repair-1',
      sessionId: 'session-1',
      assistantOutput: 'answer-2',
    });
    expect(recoveredResolver).not.toHaveBeenCalled();
  });
});
