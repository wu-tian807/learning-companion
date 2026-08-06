import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { GenerationTaskDatabaseApi } from './generation-task-database';
import { GenerationTaskDefinitionRegistry } from './generation-task-definition-registry';
import type { GenerationTaskSnapshot } from './generation-task';
import { GenerationAgentExecutor } from './generation-agent-executor';
import type {
  GenerationAgentEvent,
  GenerationAgentRunner,
  GenerationAgentRunnerResolver,
} from './generation-agent-runner';
import { GenerationTaskExecution } from './generation-task-execution';
import { GenerationTaskOutputFile } from './generation-task-output-file';
import { GenerationTaskService } from './generation-task-service';
import type { GenerationTaskPreparerApi } from './preparation/generation-task-preparer';
import type { PreparedGenerationTask } from './preparation/prepared-generation-task';
import { createTextAgentUserMessage } from './contracts/agent-message';
import { MindMapGenerationInstruction } from '../../workbenches/mindmap/generation/mindmap-generation-instruction';
import { createMindMapGenerationTaskDefinitionV1 } from '../../workbenches/mindmap/generation/mindmap-generation-task-definition';

const temporaryDirectories: string[] = [];

class MemoryDatabase implements GenerationTaskDatabaseApi {
  readonly tasks = new Map<string, GenerationTaskSnapshot>();
  get(id: string) {
    return this.tasks.get(id);
  }
  listByProject(projectId: string) {
    return [...this.tasks.values()].filter(
      (task) => task.projectId === projectId,
    );
  }
  listUnfinishedByProject(projectId: string) {
    return this.listByProject(projectId).filter(
      (task) => !task.postProcessed && task.cancelledTime === undefined,
    );
  }
  create(task: GenerationTaskSnapshot) {
    this.tasks.set(task.id, task);
  }
  update(task: GenerationTaskSnapshot) {
    this.tasks.set(task.id, task);
  }
  delete(id: string) {
    this.tasks.delete(id);
  }
}

async function drain<TEvent, TResult>(
  generator: AsyncGenerator<TEvent, TResult>,
): Promise<TResult> {
  let next = await generator.next();

  while (!next.done) {
    next = await generator.next();
  }

  return next.value;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('GenerationTask recovery', () => {
  it('resumes at post-process without invoking the Provider again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generation-recovery-'));
    temporaryDirectories.push(directory);
    const primaryPath = join(directory, 'generation-mindmap', 'task-1');
    await mkdir(join(primaryPath, 'control'), { recursive: true });
    let commitCount = 0;
    const definition = createMindMapGenerationTaskDefinitionV1({
      async commit() {
        commitCount += 1;
        if (commitCount === 1) {
          throw new Error('simulated commit interruption');
        }
        return { resultAssetId: 'mindmap-1' };
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
      userMessage: createTextAgentUserMessage('generate'),
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
    const preparer = {
      prepare: async () => prepared,
      restore: async () => prepared,
    } satisfies GenerationTaskPreparerApi;
    const database = new MemoryDatabase();
    let firstRunnerCalls = 0;
    const firstRunner: GenerationAgentRunner = {
      providerId: 'codex',
      async *runTurn() {
        yield* [] as GenerationAgentEvent[];
        firstRunnerCalls += 1;
        return {
          output: {
            title: 'Map',
            rootNodeId: 'root',
            nodes: {
              root: {
                id: 'root',
                title: 'Root',
                focus: 'Overview',
                childIds: [],
                sourceAliases: ['sources-0001'],
              },
            },
            frames: {},
          },
          sessionId: 'session-1',
          providerId: 'codex',
          modelId: 'gpt-5.2',
          startedTime: 10,
          completedTime: 20,
          activeDurationMs: 10,
        };
      },
    };
    const createService = (runnerResolver: GenerationAgentRunnerResolver) =>
      new GenerationTaskService(
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
        { createId: () => 'task-1' },
      );
    const firstResolverCalls: Array<string | undefined> = [];
    const firstService = createService({
      async resolveRunner(providerId?: string) {
        firstResolverCalls.push(providerId);
        return firstRunner;
      },
    });
    firstService.loadFromProject('project-1');
    const task = firstService.create({
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new MindMapGenerationInstruction().toSnapshot(),
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
    });

    await expect(drain(firstService.run(task.id))).rejects.toThrow(
      'simulated commit interruption',
    );
    expect(firstRunnerCalls).toBe(1);
    expect(firstResolverCalls).toEqual([undefined]);
    expect(database.get(task.id)).toMatchObject({
      assignedProviderId: 'codex',
      agentCompleted: { sessionId: 'session-1' },
      failure: { phase: 'post-process' },
    });

    let resumedRunnerCalls = 0;
    const resumedRunner: GenerationAgentRunner = {
      providerId: 'codex',
      async *runTurn() {
        yield* [] as GenerationAgentEvent[];
        resumedRunnerCalls += 1;
        throw new Error('Provider must not run after agent checkpoint');
      },
    };
    let resumedResolverCalls = 0;
    const resumedService = createService({
      async resolveRunner() {
        resumedResolverCalls += 1;
        return resumedRunner;
      },
    });
    resumedService.loadFromProject('project-1');
    const result = await drain(resumedService.run(task.id));

    expect(resumedRunnerCalls).toBe(0);
    expect(resumedResolverCalls).toBe(0);
    expect(result).toMatchObject({
      result: { resultAssetId: 'mindmap-1' },
      sessionId: 'session-1',
    });
    expect(commitCount).toBe(2);
    expect(database.tasks.size).toBe(1);
    expect(database.get(task.id)?.postProcessed).toBeDefined();

    const reloadedService = createService({
      async resolveRunner() {
        return resumedRunner;
      },
    });
    expect(reloadedService.loadFromProject('project-1')).toEqual([]);
  });
});
