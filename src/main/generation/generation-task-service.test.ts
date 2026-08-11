import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTextAgentUserMessage } from './contracts/agent-message';
import type { GenerationTaskDatabaseApi } from './generation-task-database';
import { GenerationTaskDefinitionRegistry } from './generation-task-definition-registry';
import type { GenerationTaskSnapshot } from './generation-task';
import { GenerationAgentExecutor } from './generation-agent-executor';
import { GenerationTaskExecution } from './generation-task-execution';
import { GenerationTaskService } from './generation-task-service';
import type { GenerationAgentRunner } from './generation-agent-runner';
import type { GenerationTaskPreparerApi } from './preparation/generation-task-preparer';
import type { PreparedGenerationTask } from './preparation/prepared-generation-task';
import { MindMapGenerationInstruction } from '../../workbenches/mindmap/generation/mindmap-generation-instruction';
import { createMindMapGenerationTaskDefinitionV1 } from '../../workbenches/mindmap/generation/mindmap-generation-task-definition';
import {
  MIND_MAP_GENERATION_CANDIDATE_FORMAT,
  MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH,
  MIND_MAP_GENERATION_CANDIDATE_VERSION,
} from '../../workbenches/mindmap/generation/mindmap-generation-output';

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
      (task) => !task.completed && task.cancelledTime === undefined,
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
  it('uses an Agent-authored workspace file and records actual usage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generation-service-'));
    temporaryDirectories.push(directory);
    const primaryPath = join(directory, 'generation-mindmap', 'task-1');
    await mkdir(join(primaryPath, 'control'), { recursive: true });
    const committedCandidates: unknown[] = [];
    const definition = createMindMapGenerationTaskDefinitionV1({
      async process(context) {
        await context.agent.call({
          callKey: 'generate',
          purpose: 'generation',
        });
        committedCandidates.push(
          JSON.parse(
            await readFile(
              join(
                context.workspaces.primary.path,
                ...MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH.split('/'),
              ),
              'utf8',
            ),
          ),
        );
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
      providerSelectorId: definition.providerSelectorId,
      outputMode: 'workspace-artifact',
      instruction: new MindMapGenerationInstruction(),
      systemInstruction: definition.systemInstruction,
      defaultUserMessage: createTextAgentUserMessage('生成思维导图'),
      toolRequirements: definition.toolRequirements,
      skills: definition.skills,
      mcpServers: definition.mcpServers,
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
    const requests: Array<{
      readonly sessionId?: string;
      readonly modelId?: string;
      readonly reasoningEffort?: string;
    }> = [];
    let turnNumber = 0;
    const runner: GenerationAgentRunner = {
      providerId: 'codex',
      connectionId: 'codex-account',
      async *runTurn(request) {
        requests.push({
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          ...(request.modelId ? { modelId: request.modelId } : {}),
          ...(request.reasoningEffort
            ? { reasoningEffort: request.reasoningEffort }
            : {}),
        });
        turnNumber += 1;
        yield { type: 'assistant-delta', delta: `turn-${turnNumber}` };
        await mkdir(join(primaryPath, 'output'), { recursive: true });
        await writeFile(
          join(
            primaryPath,
            ...MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH.split('/'),
          ),
          `${JSON.stringify({
            format: MIND_MAP_GENERATION_CANDIDATE_FORMAT,
            version: MIND_MAP_GENERATION_CANDIDATE_VERSION,
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
          })}\n`,
          'utf8',
        );
        return {
          sessionId: 'session-1',
          providerId: 'codex',
          connectionId: 'codex-account',
          modelId: 'gpt-5.2',
          providerExecutionId: `turn-${turnNumber}`,
          startedTime: turnNumber * 10,
          completedTime: turnNumber * 10 + 5,
          activeDurationMs: 5,
          assistantOutput: `answer-${turnNumber}`,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        };
      },
    };
    const database = new MemoryGenerationTaskDatabase();
    const resolvedProviderIds: string[] = [];
    let selectedProviderId = 'codex';
    let selectedConnectionId = 'codex-account';
    let selectedModelId = 'gpt-original';
    let selectedReasoningEffort = 'high';
    let codexRunner: GenerationAgentRunner = runner;
    const resolvedConfigurations: Array<{
      readonly providerId: string;
      readonly connectionId?: string;
      readonly modelId?: string;
      readonly reasoningEffort?: string;
    }> = [];
    const runnerResolver = {
      resolveSelectorConfiguration() {
        return {
          providerId: selectedProviderId,
          connectionId: selectedConnectionId,
          modelId: selectedModelId,
          reasoningEffort: selectedReasoningEffort,
        };
      },
      async resolveRunner(configuration: {
        providerId: string;
        connectionId?: string;
        modelId?: string;
        reasoningEffort?: string;
      }) {
        resolvedConfigurations.push({ ...configuration });
        resolvedProviderIds.push(configuration.providerId);

        if (configuration.providerId !== 'codex') {
          throw new Error(
            `unexpected Provider: ${configuration.providerId}`,
          );
        }

        return codexRunner;
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

    expect(requests).toEqual([
      { modelId: 'gpt-original', reasoningEffort: 'high' },
    ]);
    expect(resolvedProviderIds).toEqual(['codex']);
    expect(database.get('task-1')?.assignedProviderId).toBe('codex');
    expect(database.get('task-1')?.assignedConnectionId).toBe(
      'codex-account',
    );
    expect(next.value).toMatchObject({
      taskId: 'task-1',
      result: { resultAssetId: 'generated-mindmap' },
      sessionId: 'session-1',
      metrics: {
        totalUsage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        agentExecutions: [
          {
            callKey: 'generate',
            purpose: 'generation',
            providerId: 'codex',
            connectionId: 'codex-account',
            modelId: 'gpt-5.2',
            sessionId: 'session-1',
            turnCount: 1,
            repairTurnCount: 0,
          },
        ],
      },
    });
    expect(committedCandidates).toHaveLength(1);
    expect(database.tasks.size).toBe(1);
    expect(database.get('task-1')?.completed).toBeDefined();
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
        event.value.phase === 'process' &&
        event.value.state === 'completed'
      ) {
        await interruptedExecution.return(undefined as never);
        break;
      }
    }

    expect(
      database.get(completedWithoutReadingReturn.id)?.completed,
    ).toBeDefined();
    expect(service.list()).toEqual([]);

    const retryable = service.create({
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new MindMapGenerationInstruction().toSnapshot(),
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
    });
    codexRunner = {
      providerId: 'codex',
      connectionId: 'codex-account',
      async *runTurn() {
        yield* [] as never[];
        throw new Error('simulated Agent interruption');
      },
    };

    await expect(drain(service.run(retryable.id))).rejects.toThrow(
      'simulated Agent interruption',
    );
    expect(database.get(retryable.id)).toMatchObject({
      assignedProviderId: 'codex',
      assignedConnectionId: 'codex-account',
      assignedModelId: 'gpt-original',
      assignedReasoningEffort: 'high',
    });

    selectedProviderId = 'claude-code';
    selectedConnectionId = 'claude-account';
    selectedModelId = 'claude-sonnet';
    selectedReasoningEffort = 'medium';
    const latestSelectionTask = service.create({
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new MindMapGenerationInstruction().toSnapshot(),
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
    });
    expect(database.get(latestSelectionTask.id)).toMatchObject({
      assignedProviderId: 'claude-code',
      assignedConnectionId: 'claude-account',
      assignedModelId: 'claude-sonnet',
      assignedReasoningEffort: 'medium',
    });
    service.cancel(latestSelectionTask.id);

    codexRunner = runner;
    await drain(service.run(retryable.id));
    expect(resolvedProviderIds.slice(-2)).toEqual(['codex', 'codex']);
    expect(resolvedConfigurations.at(-1)).toEqual({
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'gpt-original',
      reasoningEffort: 'high',
    });
    expect(requests.at(-1)).toMatchObject({
      modelId: 'gpt-original',
      reasoningEffort: 'high',
    });
    expect(database.get(retryable.id)?.completed).toBeDefined();

    selectedProviderId = 'codex';
    selectedConnectionId = 'codex-account';
    selectedModelId = 'gpt-original';
    selectedReasoningEffort = 'high';
    const backgroundEvents: string[] = [];
    const unsubscribe = service.subscribe((event) => {
      backgroundEvents.push(event.type);
    });
    const background = service.start({
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new MindMapGenerationInstruction().toSnapshot(),
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
    });

    await vi.waitFor(() =>
      expect(database.get(background.id)?.completed).toBeDefined(),
    );
    await vi.waitFor(() =>
      expect(backgroundEvents).toContain('task-completed'),
    );
    expect(service.list().some(({ id }) => id === background.id)).toBe(
      false,
    );
    unsubscribe();

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
