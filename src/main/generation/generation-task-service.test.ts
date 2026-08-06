import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { JsonValue } from '../../shared/workbench/protocol';
import { createTextAgentUserMessage } from './contracts/agent-message';
import type { GenerationTaskDatabaseApi } from './generation-task-database';
import { GenerationTaskDefinitionRegistry } from './generation-task-definition-registry';
import type { GenerationTaskSnapshot } from './generation-task';
import { GenerationAgentExecutor } from './generation-agent-executor';
import { GenerationTaskExecution } from './generation-task-execution';
import { GenerationTaskService } from './generation-task-service';
import { GenerationTaskOutputFile } from './generation-task-output-file';
import type { GenerationAgentRunner } from './generation-agent-runner';
import type { GenerationTaskPreparerApi } from './preparation/generation-task-preparer';
import type { PreparedGenerationTask } from './preparation/prepared-generation-task';
import { MindMapGenerationInstruction } from '../../workbenches/mindmap/generation/mindmap-generation-instruction';
import { createMindMapGenerationTaskDefinitionV1 } from '../../workbenches/mindmap/generation/mindmap-generation-task-definition';

const temporaryDirectories: string[] = [];

async function drain<TEvent, TResult>(
  generator: AsyncGenerator<TEvent, TResult>,
): Promise<TResult> {
  let next = await generator.next();

  while (!next.done) {
    next = await generator.next();
  }

  return next.value;
}

class MemoryGenerationTaskDatabase implements GenerationTaskDatabaseApi {
  readonly tasks = new Map<string, GenerationTaskSnapshot>();

  get(taskId: string): GenerationTaskSnapshot | undefined {
    return this.tasks.get(taskId);
  }

  listByProject(projectId: string): readonly GenerationTaskSnapshot[] {
    return [...this.tasks.values()].filter(
      (task) => task.projectId === projectId,
    );
  }

  listUnfinishedByProject(
    projectId: string,
  ): readonly GenerationTaskSnapshot[] {
    return this.listByProject(projectId).filter(
      (task) => !task.postProcessed && task.cancelledTime === undefined,
    );
  }

  create(task: GenerationTaskSnapshot): void {
    this.tasks.set(task.id, task);
  }

  update(task: GenerationTaskSnapshot): void {
    this.tasks.set(task.id, task);
  }

  delete(taskId: string): void {
    this.tasks.delete(taskId);
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('GenerationTaskService', () => {
  it('repairs invalid output in the same session and records actual usage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generation-service-'));
    temporaryDirectories.push(directory);
    const primaryPath = join(directory, 'generation-mindmap', 'task-1');
    await mkdir(join(primaryPath, 'control'), { recursive: true });
    const committedCandidates: unknown[] = [];
    const definition = createMindMapGenerationTaskDefinitionV1({
      async commit(input) {
        committedCandidates.push(input.candidate);
        return { resultAssetId: 'generated-mindmap' };
      },
    });
    const registry = new GenerationTaskDefinitionRegistry();
    registry.register(definition);
    const prepared: PreparedGenerationTask = {
      taskId: 'task-1',
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new MindMapGenerationInstruction(),
      systemInstruction: definition.systemInstruction,
      userMessage: createTextAgentUserMessage('生成思维导图'),
      allowedTools: definition.allowedTools,
      workspaces: {
        primary: {
          ...definition.primaryWorkspaceConfig,
          instanceKey: 'task-1',
          path: primaryPath,
        },
        secondary: [],
      },
      assetReferences: {
        sources: [
          {
            alias: 'sources-0001',
            assetId: 'asset-1',
            name: 'lesson.md',
            mediaType: 'text/markdown',
            contentRevision: 'revision',
            relativePath: 'references/sources-0001/source.md',
          },
        ],
      },
      outputContract: definition.outputContract,
      manifestRef: 'control/prepared-manifest.json',
    };
    const prepareTask = (task: GenerationTaskSnapshot) => ({
      ...prepared,
      taskId: task.id,
      workspaces: {
        ...prepared.workspaces,
        primary: {
          ...prepared.workspaces.primary,
          instanceKey: task.id,
        },
      },
    });
    const preparer = {
      prepare: async (task: GenerationTaskSnapshot) => prepareTask(task),
      restore: async (task: GenerationTaskSnapshot) => prepareTask(task),
    } satisfies GenerationTaskPreparerApi;
    const requests: { readonly sessionId?: string }[] = [];
    let turnNumber = 0;
    const runner: GenerationAgentRunner = {
      providerId: 'codex',
      async *runTurn(request) {
        requests.push(
          request.sessionId ? { sessionId: request.sessionId } : {},
        );
        turnNumber += 1;
        yield { type: 'assistant-delta', delta: `turn-${turnNumber}` };
        const output: JsonValue =
          turnNumber === 1
            ? { invalid: true }
            : {
                title: '课程结构',
                rootNodeId: 'root',
                nodes: {
                  root: {
                    id: 'root',
                    title: '课程',
                    focus: '总览',
                    childIds: [],
                    sourceAliases: ['sources-0001'],
                  },
                },
                frames: {},
              };
        return {
          output,
          sessionId: 'session-1',
          providerId: 'codex',
          modelId: 'gpt-5.2',
          providerExecutionId: `turn-${turnNumber}`,
          startedTime: turnNumber * 10,
          completedTime: turnNumber * 10 + 5,
          activeDurationMs: 5,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        };
      },
    };
    const database = new MemoryGenerationTaskDatabase();
    const resolvedProviderIds: Array<string | undefined> = [];
    let selectedRunner: GenerationAgentRunner = runner;
    const runnerResolver = {
      async resolveRunner(providerId?: string) {
        resolvedProviderIds.push(providerId);

        if (providerId === undefined) {
          return selectedRunner;
        }

        if (providerId !== 'codex') {
          throw new Error(`unexpected Provider: ${providerId}`);
        }

        return runner;
      },
    };
    let nextTaskNumber = 1;
    const service = new GenerationTaskService(
      database,
      registry,
      new GenerationTaskExecution(
        database,
        preparer,
        new GenerationAgentExecutor(),
        new GenerationTaskOutputFile(),
      ),
      {
        get: () => ({
          id: 'project-1',
          name: 'Project',
          icon: '📘',
          createdTime: 1,
          pinned: false,
          workspacePath: primaryPath,
        }),
      },
      runnerResolver,
      { createId: () => `task-${nextTaskNumber++}` },
    );
    service.loadFromProject('project-1');
    const task = service.create({
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new MindMapGenerationInstruction().toSnapshot(),
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
    });
    const events = [];
    const execution = service.run(task.id);
    let next = await execution.next();

    while (!next.done) {
      events.push(next.value);
      next = await execution.next();
    }

    expect(requests).toEqual([{}, { sessionId: 'session-1' }]);
    expect(resolvedProviderIds).toEqual([undefined]);
    expect(database.get('task-1')?.assignedProviderId).toBe('codex');
    expect(
      events.filter(({ type }) => type === 'output-rejected'),
    ).toHaveLength(1);
    expect(next.value).toMatchObject({
      taskId: 'task-1',
      result: { resultAssetId: 'generated-mindmap' },
      sessionId: 'session-1',
      metrics: {
        totalUsage: {
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
        },
        agentExecutions: [
          {
            providerId: 'codex',
            modelId: 'gpt-5.2',
            sessionId: 'session-1',
            turnCount: 2,
            repairTurnCount: 1,
          },
        ],
      },
    });
    expect(committedCandidates).toHaveLength(1);
    expect(database.tasks.size).toBe(1);
    expect(database.get('task-1')?.postProcessed).toBeDefined();
    expect(service.list()).toEqual([]);

    const completedWithoutReadingReturn = service.create({
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new MindMapGenerationInstruction().toSnapshot(),
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
    });
    const interruptedExecution = service.run(completedWithoutReadingReturn.id);

    while (true) {
      const event = await interruptedExecution.next();

      if (event.done) {
        break;
      }

      if (
        event.value.type === 'phase' &&
        event.value.phase === 'post-process' &&
        event.value.state === 'completed'
      ) {
        await interruptedExecution.return(undefined as never);
        break;
      }
    }

    expect(
      database.get(completedWithoutReadingReturn.id)?.postProcessed,
    ).toBeDefined();
    expect(service.list()).toEqual([]);

    const retryable = service.create({
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new MindMapGenerationInstruction().toSnapshot(),
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
    });
    selectedRunner = {
      providerId: 'codex',
      async *runTurn() {
        yield* [] as never[];
        throw new Error('simulated Agent interruption');
      },
    };

    await expect(drain(service.run(retryable.id))).rejects.toThrow(
      'simulated Agent interruption',
    );
    expect(database.get(retryable.id)?.assignedProviderId).toBe('codex');

    selectedRunner = {
      providerId: 'claude-code',
      async *runTurn() {
        yield* [] as never[];
        throw new Error('switched Provider must not run this task');
      },
    };
    await drain(service.run(retryable.id));
    expect(resolvedProviderIds.slice(-2)).toEqual([undefined, 'codex']);
    expect(database.get(retryable.id)?.postProcessed).toBeDefined();

    const cancelled = service.create({
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new MindMapGenerationInstruction().toSnapshot(),
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
    });
    service.cancel(cancelled.id);

    expect(database.get(cancelled.id)?.cancelledTime).toBeDefined();
    expect(service.list()).toEqual([]);
    expect(service.loadFromProject('project-1')).toEqual([]);
  });
});
