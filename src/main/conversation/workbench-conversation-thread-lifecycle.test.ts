import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedAgentProviderConnection } from '../agents/agent-provider';
import type { CodexAppServerConnectionFactoryApi } from '../agents/codex/codex-app-server-process';
import type {
  CodexConnectionClose,
  CodexRpcConnectionApi,
  CodexRpcIncomingEvent,
} from '../agents/codex/codex-rpc-connection';
import { CodexRuntimeService } from '../agents/codex/codex-runtime-service';
import { CodexAgentProvider } from '../agents/providers/codex-agent-provider';
import { AgentSessionService } from '../agents/sessions/agent-session-service';
import { AgentWorkspaceManager } from '../agents/workspaces/agent-workspace-manager';
import type { ProjectLookup } from '../projects/project-database';
import { GenerationAgentExecutor } from '../generation/generation-agent-executor';
import { GenerationTaskAgentSession } from '../generation/generation-task-agent-session';
import type { GenerationTaskDatabaseApi } from '../generation/generation-task-database';
import { GenerationTask } from '../generation/generation-task';
import { GenerationTaskPreparer } from '../generation/preparation/generation-task-preparer';
import { WorkbenchConversationContextProviderRegistry } from './workbench-conversation-context-provider-registry';
import { WorkbenchConversationInstruction } from './workbench-conversation-instruction';
import { createWorkbenchConversationTaskDefinitionV1 } from './workbench-conversation-task-definition';

interface RecordedRequest {
  readonly method: string;
  readonly params: unknown;
  readonly timeoutMs?: number;
}

class RecordingCodexConnection implements CodexRpcConnectionApi {
  readonly requests: RecordedRequest[] = [];
  readonly closed: Promise<CodexConnectionClose>;

  private readonly listeners = new Set<
    (event: CodexRpcIncomingEvent) => void
  >();
  private readonly resolveClosed: (result: CodexConnectionClose) => void;
  private threadNumber = 0;
  private turnNumber = 0;

  constructor() {
    let resolveClosed:
      | ((result: CodexConnectionClose) => void)
      | undefined;
    this.closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    this.resolveClosed = (result) => resolveClosed?.(result);
  }

  async request<TResult>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<TResult> {
    this.requests.push({ method, params, timeoutMs });

    if (method === 'initialize') {
      return {} as TResult;
    }
    if (method === 'account/read') {
      return {
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      } as TResult;
    }
    if (method === 'config/read') {
      return { config: { mcp_servers: {} } } as TResult;
    }
    if (method === 'skills/list') {
      return { data: [] } as TResult;
    }
    if (method === 'thread/start') {
      this.threadNumber += 1;
      return this.selection(`thread-${this.threadNumber}`) as TResult;
    }
    if (method === 'thread/resume') {
      return this.selection(this.requireTextParam(params, 'threadId')) as TResult;
    }
    if (method === 'turn/start') {
      const threadId = this.requireTextParam(params, 'threadId');
      this.turnNumber += 1;
      const turnId = `turn-${this.turnNumber}`;
      queueMicrotask(() => {
        this.emit({
          type: 'notification',
          method: 'turn/completed',
          params: {
            threadId,
            turn: {
              id: turnId,
              status: 'completed',
              startedAt: this.turnNumber * 1_000,
              completedAt: this.turnNumber * 1_000 + 100,
              durationMs: 100,
              items: [
                {
                  id: `message-${this.turnNumber}`,
                  type: 'agentMessage',
                  phase: 'final_answer',
                  text: `answer-${this.turnNumber}`,
                },
              ],
            },
          },
        });
      });
      return { turn: { id: turnId, status: 'inProgress' } } as TResult;
    }

    throw new Error(`Unexpected Codex RPC method: ${method}`);
  }

  async notify(): Promise<void> {}

  async respond(): Promise<void> {}

  async respondError(): Promise<void> {}

  subscribe(
    listener: (event: CodexRpcIncomingEvent) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.resolveClosed({ code: 0, signal: null, stderr: '' });
  }

  private emit(event: CodexRpcIncomingEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private selection(threadId: string) {
    return {
      thread: { id: threadId, turns: [] },
      model: 'gpt-test',
      modelProvider: 'openai',
    };
  }

  private requireTextParam(params: unknown, key: string): string {
    if (
      typeof params !== 'object' ||
      params === null ||
      Array.isArray(params) ||
      typeof (params as Record<string, unknown>)[key] !== 'string'
    ) {
      throw new Error(`Missing Codex RPC parameter: ${key}`);
    }
    return (params as Record<string, string>)[key]!;
  }
}

const accountConnection: ResolvedAgentProviderConnection = Object.freeze({
  configuration: Object.freeze({
    id: 'codex-account',
    providerId: 'codex',
    kind: 'account',
    displayName: 'ChatGPT account',
  }),
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Workbench Conversation Codex thread lifecycle', () => {
  it('resumes one Codex thread across Tasks with the same conversationId', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-conversation-thread-'),
    );
    temporaryDirectories.push(directory);
    const projectWorkspacePath = join(directory, 'project-workspace');
    await mkdir(projectWorkspacePath);

    const projectLookup: ProjectLookup = {
      get: (id) =>
        id === 'project-1'
          ? {
              id,
              name: 'Project 1',
              icon: 'P',
              pinned: false,
              createdTime: 1,
              workspacePath: projectWorkspacePath,
            }
          : undefined,
    };
    const connection = new RecordingCodexConnection();
    const connectionFactory: CodexAppServerConnectionFactoryApi = {
      connect: vi.fn(async () => connection),
    };
    const runtime = new CodexRuntimeService(connectionFactory);
    const providers = new WorkbenchConversationContextProviderRegistry();
    providers.register({
      id: 'test.conversation',
      async prepare(context) {
        return {
          purpose: 'answer',
          statusMessage: 'Answering',
          systemInstruction: 'Answer only the current user question.',
          userMessage: context.preparedUserMessage,
          toolRequirements: [],
        };
      },
    });
    const definition = createWorkbenchConversationTaskDefinitionV1(providers);
    const preparer = new GenerationTaskPreparer(
      new AgentWorkspaceManager(join(projectWorkspacePath, 'agent-workspaces')),
      {
        prepare: vi.fn(async () => Object.freeze({})),
        verify: vi.fn(async () => Object.freeze({})),
      },
    );
    const database = {
      update: vi.fn(),
    } as unknown as GenerationTaskDatabaseApi;
    let now = 10;

    const createSessionService = () => {
      const service = new AgentSessionService(projectLookup, {
        now: () => now++,
      });
      service.loadFromProject('project-1');
      return service;
    };

    const executeTask = async (
      taskId: string,
      conversationId: string,
      question: string,
      provider: CodexAgentProvider,
    ) => {
      const instruction = new WorkbenchConversationInstruction({
        contextProviderId: 'test.conversation',
        assetId: 'asset-1',
        conversationId,
        question,
      });
      const task = GenerationTask.create({
        id: taskId,
        projectId: 'project-1',
        definitionId: definition.id,
        definitionVersion: definition.version,
        instruction: instruction.toSnapshot(),
        assetReferences: {},
        createdTime: now++,
      });
      const prepared = await preparer.prepare(task.getSnapshot(), definition);
      task.recordPrepared({
        checkpoint: {
          completedTime: now,
          assetReferences: prepared.assetReferences,
        },
        durationMs: 1,
        updatedTime: now++,
      });
      const signal = new AbortController().signal;
      const runner = provider.createRunner(accountConnection);
      const agent = new GenerationTaskAgentSession(
        task,
        prepared,
        database,
        new GenerationAgentExecutor(),
        {
          resolveSelectorConfiguration: () => ({
            providerId: 'codex',
            connectionId: 'codex-account',
          }),
          resolveRunner: async () => runner,
        },
        signal,
        { now: () => now++, emit: vi.fn() },
      );
      const result = await definition.process({
        taskId,
        projectId: 'project-1',
        instruction,
        workspaces: prepared.workspaces,
        assetReferences: prepared.assetReferences,
        preparedUserMessage: prepared.preparedUserMessage,
        agent,
        signal,
        reportStatus: vi.fn(),
        reportOutputRejected: vi.fn(),
      });

      return { prepared, result };
    };

    const firstSessions = createSessionService();
    const firstProvider = new CodexAgentProvider(runtime, firstSessions);
    const first = await executeTask(
      'task-1',
      'conversation-shared',
      'first question',
      firstProvider,
    );
    await firstProvider.dispose();

    // Recreate the Main-process Session service to prove that the persisted
    // conversationId binding, rather than a task-local object, owns reuse.
    const restoredSessions = createSessionService();
    const restoredProvider = new CodexAgentProvider(runtime, restoredSessions);
    const second = await executeTask(
      'task-2',
      'conversation-shared',
      'second question',
      restoredProvider,
    );
    const isolated = await executeTask(
      'task-3',
      'conversation-isolated',
      'isolated question',
      restoredProvider,
    );

    expect(first.prepared.workspaces.primary.instanceKey).toBe(
      'conversation-shared',
    );
    expect(second.prepared.workspaces.primary.instanceKey).toBe(
      'conversation-shared',
    );
    expect(isolated.prepared.workspaces.primary.instanceKey).toBe(
      'conversation-isolated',
    );
    expect([first.result.answer, second.result.answer, isolated.result.answer])
      .toEqual(['answer-1', 'answer-2', 'answer-3']);

    const requestsByMethod = (method: string) =>
      connection.requests.filter((request) => request.method === method);
    expect(requestsByMethod('thread/start')).toHaveLength(2);
    expect(requestsByMethod('thread/resume')).toHaveLength(1);
    expect(requestsByMethod('thread/resume')[0]?.params).toMatchObject({
      threadId: 'thread-1',
      excludeTurns: false,
    });

    const turnRequests = requestsByMethod('turn/start');
    expect(turnRequests).toHaveLength(3);
    expect(
      turnRequests.map((request) =>
        (request.params as { readonly threadId: string }).threadId,
      ),
    ).toEqual(['thread-1', 'thread-1', 'thread-2']);
    expect(JSON.stringify(turnRequests[1]?.params)).toContain(
      'second question',
    );
    expect(JSON.stringify(turnRequests[1]?.params)).not.toContain(
      'first question',
    );

    await restoredProvider.dispose();
    await runtime.shutdown();
  });
});
