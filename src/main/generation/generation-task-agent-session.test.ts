import { describe, expect, it, vi } from 'vitest';

import { createTextAgentUserMessage } from './contracts/agent-message';
import type { TaskAgentCallRequest } from './contracts/task-definition';
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
        assetReferences: {},
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
      instruction: {
        toSnapshot: () => null,
        toUserMessage: () => createTextAgentUserMessage('generate'),
      },
      preparedUserMessage: createTextAgentUserMessage('generate'),
      workspaces: {
        primary: {
          key: 'generation-mindmap',
          permissions: { read: true, write: true },
          instanceKey: 'task-1',
          path: 'D:\\tmp\\task-1',
        },
        secondary: [],
      },
      assetReferences: { sources: [] },
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

    const generateRequest = {
      callKey: 'generate',
      purpose: 'generation',
      systemInstruction: 'Generate a candidate.',
      userMessage: createTextAgentUserMessage('generate'),
      toolRequirements: [
        { id: 'generate_candidate', availability: 'required' },
      ],
      skills: [{ id: 'mindmap', availability: 'optional' }],
      mcpServers: [],
    } satisfies TaskAgentCallRequest;
    const repairRequest = {
      callKey: 'repair-1',
      purpose: 'repair',
      systemInstruction: 'Repair only the rejected output.',
      userMessage: createTextAgentUserMessage('repair it'),
      toolRequirements: [
        { id: 'repair_candidate', availability: 'required' },
      ],
      skills: [],
      mcpServers: [{ id: 'validator', availability: 'optional' }],
    } satisfies TaskAgentCallRequest;

    await expect(
      session.call({
        ...generateRequest,
        callKey: 'invalid-system-instruction',
        systemInstruction: '   ',
      }),
    ).rejects.toThrow('systemInstruction 不能为空');
    await expect(
      session.call({
        ...generateRequest,
        callKey: 'duplicate-tools',
        toolRequirements: [
          { id: 'generate_candidate', availability: 'required' },
          { id: 'generate_candidate', availability: 'optional' },
        ],
      }),
    ).rejects.toThrow('tool requirement 重复');
    expect(resolveRunner).not.toHaveBeenCalled();

    const generated = await session.call(generateRequest);
    await session.call(repairRequest);

    expect(resolveRunner).toHaveBeenCalledOnce();
    expect(generated.assistantOutput).toBe('answer-1');
    expect(requests.map(({ callKey, sessionId }) => ({ callKey, sessionId })))
      .toEqual([
        { callKey: 'generate', sessionId: undefined },
        { callKey: 'repair-1', sessionId: 'session-1' },
      ]);
    expect(requests).toMatchObject([
      {
        systemInstruction: 'Generate a candidate.',
        toolRequirements: [
          { id: 'generate_candidate', availability: 'required' },
        ],
        skills: [{ id: 'mindmap', availability: 'optional' }],
        mcpServers: [],
      },
      {
        systemInstruction: 'Repair only the rejected output.',
        toolRequirements: [
          { id: 'repair_candidate', availability: 'required' },
        ],
        skills: [],
        mcpServers: [{ id: 'validator', availability: 'optional' }],
      },
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
      recovered.call(repairRequest),
    ).resolves.toMatchObject({
      callKey: 'repair-1',
      sessionId: 'session-1',
      assistantOutput: 'answer-2',
    });
    expect(recoveredResolver).not.toHaveBeenCalled();
  });

  it('runs different stable session groups in parallel and resumes each group independently', async () => {
    const task = GenerationTask.create({
      id: 'task-parallel',
      projectId: 'project-1',
      definitionId: 'media-subtitle.translate',
      definitionVersion: 1,
      instruction: { format: 'test', version: 1 },
      assetReferences: {},
      createdTime: 1,
    });
    task.recordPrepared({
      checkpoint: { completedTime: 2, assetReferences: {} },
      durationMs: 1,
      updatedTime: 2,
    });
    const prepared = {
      taskId: 'task-parallel',
      projectId: 'project-1',
      definitionId: 'media-subtitle.translate',
      definitionVersion: 1,
      providerSelectorId: 'low-intelligence',
      instruction: {
        toSnapshot: () => null,
        toUserMessage: () => createTextAgentUserMessage('translate'),
      },
      preparedUserMessage: createTextAgentUserMessage('translate'),
      workspaces: {
        primary: {
          key: 'media-subtitle-translation',
          permissions: { read: false, write: false },
          instanceKey: 'task-parallel',
          path: 'D:\\tmp\\task-parallel',
        },
        secondary: [],
      },
      assetReferences: {},
    } as PreparedGenerationTask;
    const requests: GenerationAgentTurnRequest[] = [];
    let releaseParallelCalls: () => void = () => undefined;
    const parallelCallsStarted = new Promise<void>((resolve) => {
      releaseParallelCalls = resolve;
    });
    const runner: GenerationAgentRunner = {
      providerId: 'codex',
      connectionId: 'codex-account',
      async *runTurn(request) {
        yield* [] as never[];
        requests.push(request);
        if (requests.length === 2) releaseParallelCalls();
        if (request.callKey !== 'repair-chunk-1') {
          await parallelCallsStarted;
        }
        const sessionId = `session-${request.sessionLocator.instanceKey
          .split('--')
          .at(-1)}`;
        return {
          sessionId,
          providerId: 'codex',
          connectionId: 'codex-account',
          modelId: 'gpt-5.6-luna',
          startedTime: 10,
          completedTime: 20,
          activeDurationMs: 10,
          assistantOutput: request.callKey,
        };
      },
    };
    const resolveRunner = vi.fn(async () => runner);
    let checkpointTime = 30;
    const session = new GenerationTaskAgentSession(
      task,
      prepared,
      { update: vi.fn() } as unknown as GenerationTaskDatabaseApi,
      new GenerationAgentExecutor(),
      {
        resolveSelectorConfiguration: () => ({
          providerId: 'codex',
          connectionId: 'codex-account',
          modelId: 'gpt-5.6-luna',
          reasoningEffort: 'low',
        }),
        resolveRunner,
      },
      new AbortController().signal,
      { now: () => checkpointTime++, emit: vi.fn() },
    );
    const request = (
      callKey: string,
      sessionKey: string,
    ): TaskAgentCallRequest => ({
      callKey,
      purpose: 'translate',
      sessionKey,
      systemInstruction: 'Return JSON only.',
      userMessage: createTextAgentUserMessage(callKey),
      toolRequirements: [],
      skills: [],
      mcpServers: [],
      assistantEvents: 'none',
    });

    await Promise.all([
      session.call(request('translate-chunk-1', 'chunk-1')),
      session.call(request('translate-chunk-2', 'chunk-2')),
    ]);
    await session.call(request('repair-chunk-1', 'chunk-1'));

    expect(resolveRunner).toHaveBeenCalledOnce();
    expect(requests.slice(0, 2).map(({ callKey }) => callKey).sort()).toEqual([
      'translate-chunk-1',
      'translate-chunk-2',
    ]);
    expect(requests[0]?.sessionId).toBeUndefined();
    expect(requests[1]?.sessionId).toBeUndefined();
    expect(requests[2]).toMatchObject({
      callKey: 'repair-chunk-1',
      sessionId: 'session-chunk-1',
    });
    expect(task.getSnapshot().agentCalls).toEqual([
      expect.objectContaining({
        callKey: 'translate-chunk-1',
        sessionKey: 'chunk-1',
        sessionId: 'session-chunk-1',
      }),
      expect.objectContaining({
        callKey: 'translate-chunk-2',
        sessionKey: 'chunk-2',
        sessionId: 'session-chunk-2',
      }),
      expect.objectContaining({
        callKey: 'repair-chunk-1',
        sessionKey: 'chunk-1',
        sessionId: 'session-chunk-1',
      }),
    ]);
  });
});
