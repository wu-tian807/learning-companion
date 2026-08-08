import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type {
  GenerationAgentEvent,
  GenerationAgentTurnRequest,
  GenerationAgentTurnResult,
} from '../../generation/generation-agent-runner';
import { AppError } from '../../errors/app-error';
import { CodexRpcError } from '../codex/codex-rpc-connection';
import type { CodexRuntimeServiceApi } from '../codex/codex-runtime-service-api';
import type {
  CodexThreadSelection,
  CodexTurn,
} from '../codex/codex-runtime-types';
import type { AgentProviderSessionBinding } from '../sessions/agent-session';
import type { AgentSessionServiceApi } from '../sessions/agent-session-service';
import { AgentFunctionToolRegistry } from '../function-tools/agent-function-tool-registry';
import { CodexAgentProvider } from './codex-agent-provider';
import { CODEX_FUNCTION_TOOL_NAMESPACE } from './codex-function-tools';

function createRuntime(
  overrides: Partial<CodexRuntimeServiceApi> = {},
): CodexRuntimeServiceApi {
  return {
    subscribe: vi.fn(() => () => undefined),
    getAccount: vi.fn(async () => ({
      account: null,
      requiresOpenaiAuth: true,
    })),
    startChatGptLogin: vi.fn(),
    cancelLogin: vi.fn(async () => undefined),
    readConfig: vi.fn(async () => ({ config: { mcp_servers: {} } })),
    listSkills: vi.fn(async () => []),
    listMcpServers: vi.fn(async () => ({ data: [], nextCursor: null })),
    ...overrides,
  } as unknown as CodexRuntimeServiceApi;
}

function completedTurn(
  clientId: string,
  output: unknown = { ok: true },
): CodexTurn {
  return {
    id: 'turn-1',
    status: 'completed',
    startedAt: 1,
    completedAt: 2,
    durationMs: 800,
    items: [
      {
        id: 'user-1',
        type: 'userMessage',
        clientId,
        content: [],
      },
      {
        id: 'message-1',
        type: 'agentMessage',
        phase: 'final_answer',
        text: JSON.stringify(output),
      },
    ],
  };
}

function selection(
  threadId: string,
  turns: readonly CodexTurn[] = [],
): CodexThreadSelection {
  return {
    thread: { id: threadId, turns },
    model: 'gpt-test',
    modelProvider: 'openai',
  };
}

function createSessions(initial?: AgentProviderSessionBinding) {
  let binding = initial;
  const service = {
    loadFromProject: vi.fn(),
    unloadProject: vi.fn(),
    getActiveProjectId: vi.fn(() => 'project'),
    get: vi.fn(),
    getProviderBinding: vi.fn(async () => binding),
    bindProvider: vi.fn(async (request) => {
      binding = {
        sessionId: request.sessionId,
        configurationFingerprint: request.configurationFingerprint,
        createdTime: 1,
      };
      return binding;
    }),
    replaceProviderBinding: vi.fn(async (request) => {
      binding = {
        sessionId: request.sessionId,
        configurationFingerprint: request.configurationFingerprint,
        createdTime: 2,
      };
      return binding;
    }),
  } as AgentSessionServiceApi;

  return { service, getBinding: () => binding };
}

function createGenerationRequest(
  overrides: Partial<GenerationAgentTurnRequest> = {},
): GenerationAgentTurnRequest {
  const workspacePath = resolve('test-fixtures', 'generation-mindmap');

  return {
    taskId: 'task-1',
    callKey: 'generate',
    projectId: 'project',
    sessionLocator: {
      projectId: 'project',
      workspaceKey: 'generation-mindmap',
      instanceKey: 'task-1',
    },
    systemInstruction: 'Generate a mind map candidate.',
    userMessage: {
      role: 'user',
      content: [{ type: 'text', text: 'Read sources and respond.' }],
    },
    toolRequirements: [],
    skills: [],
    mcpServers: [],
    workspaces: {
      primary: {
        key: 'generation-mindmap',
        scope: 'task',
        instanceKey: 'task-1',
        path: workspacePath,
        permissions: { read: true, write: false },
      },
      secondary: [],
    },
    ...overrides,
  };
}

async function collectTurn(
  generator: AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult>,
) {
  const events: GenerationAgentEvent[] = [];
  let next = await generator.next();

  while (!next.done) {
    events.push(next.value);
    next = await generator.next();
  }

  return { events, result: next.value };
}

describe('CodexAgentProvider', () => {
  it('maps account/read into a Provider credential snapshot', async () => {
    const provider = new CodexAgentProvider(
      createRuntime({
        getAccount: vi.fn(async () => ({
          account: {
            type: 'chatgpt',
            email: 'student@example.com',
            planType: 'plus',
          },
          requiresOpenaiAuth: true,
        })),
      }),
      createSessions().service,
    );

    await expect(provider.getCredentialState(true)).resolves.toEqual({
      status: 'authenticated',
      account: {
        email: 'student@example.com',
        planType: 'plus',
        authenticationMethod: 'chatgpt',
      },
    });
  });

  it('treats a missing account as unauthenticated', async () => {
    const provider = new CodexAgentProvider(
      createRuntime(),
      createSessions().service,
    );

    await expect(provider.getCredentialState()).resolves.toEqual({
      status: 'unauthenticated',
    });
  });

  it('uses the App Server managed browser login flow', async () => {
    const startChatGptLogin = vi.fn(async () => ({
      type: 'chatgpt' as const,
      loginId: 'login-1',
      authUrl: 'https://chatgpt.com/login',
    }));
    const provider = new CodexAgentProvider(
      createRuntime({ startChatGptLogin }),
      createSessions().service,
    );

    await expect(provider.startLogin()).resolves.toEqual({
      type: 'external-browser',
      providerId: 'codex',
      loginId: 'login-1',
      url: 'https://chatgpt.com/login',
    });
    expect(startChatGptLogin).toHaveBeenCalledWith('browser');
  });

  it('invalidates credentials only for account and runtime availability events', () => {
    let listener:
      | Parameters<CodexRuntimeServiceApi['subscribe']>[0]
      | undefined;
    const runtime = createRuntime({
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return () => undefined;
      }),
    });
    const invalidated = vi.fn();
    const provider = new CodexAgentProvider(
      runtime,
      createSessions().service,
    );

    provider.subscribeCredentialInvalidation(invalidated);
    listener?.({
      type: 'notification',
      notification: {
        method: 'thread/started',
        params: {},
      },
    });
    listener?.({
      type: 'notification',
      notification: {
        method: 'account/login/completed',
        params: {},
      },
    });
    listener?.({
      type: 'state-changed',
      snapshot: {
        phase: 'failed',
        failure: { message: 'closed' },
      },
    });

    expect(invalidated).toHaveBeenCalledTimes(2);
  });

  it('creates a least-privilege Codex thread and maps streamed results', async () => {
    const sessions = createSessions();
    const createThread = vi.fn(async () => selection('thread-1'));
    const startTurn = vi.fn(async function* () {
      yield {
        type: 'turn-started' as const,
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'inProgress' },
      };
      yield {
        type: 'assistant-message-delta' as const,
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'message-1',
        delta: '{"ok":',
      };
      yield {
        type: 'item-started' as const,
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'image-1',
          type: 'imageView',
          path: 'source.png',
        },
      };
      yield {
        type: 'token-usage-updated' as const,
        threadId: 'thread-1',
        turnId: 'turn-1',
        method: 'thread/tokenUsage/updated',
        params: {
          tokenUsage: {
            last: {
              inputTokens: 120,
              cachedInputTokens: 20,
              outputTokens: 30,
              reasoningOutputTokens: 10,
              totalTokens: 150,
            },
            total: {
              inputTokens: 820,
              cachedInputTokens: 600,
              outputTokens: 90,
              reasoningOutputTokens: 30,
              totalTokens: 910,
            },
          },
        },
      };
      yield {
        type: 'notification' as const,
        threadId: 'thread-1',
        turnId: 'turn-1',
        method: 'model/rerouted',
        params: { toModel: 'gpt-test-fast' },
      };
      return {
        threadId: 'thread-1',
        turn: completedTurn('unused-live-client-id'),
      };
    });
    const runtime = createRuntime({
      getAccount: vi.fn(async () => ({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      })),
      readConfig: vi.fn(async () => ({
        config: {
          mcp_servers: { 'user-mcp': { command: 'user-mcp' } },
        },
      })),
      listSkills: vi.fn(async () => [
        {
          cwd: requestWorkspacePath(),
          skills: [
            {
              name: 'user-skill',
              description: 'User-defined behavior',
              path: resolve('user-skills', 'user-skill', 'SKILL.md'),
              enabled: true,
            },
          ],
        },
      ]),
      createThread,
      startTurn,
      interruptTurn: vi.fn(async () => undefined),
    });
    const provider = new CodexAgentProvider(runtime, sessions.service, {
      now: () => 3_000,
    });
    const request = createGenerationRequest();
    const { events, result } = await collectTurn(provider.runTurn(request));

    expect(events).toEqual([
      { type: 'session-resolved', sessionId: 'thread-1' },
      { type: 'assistant-delta', delta: '{"ok":' },
      expect.objectContaining({
        type: 'tool-call',
        phase: 'started',
        callId: 'image-1',
        toolName: 'imageView',
      }),
    ]);
    expect(result).toEqual({
      sessionId: 'thread-1',
      providerId: 'codex',
      modelId: 'gpt-test-fast',
      providerExecutionId: 'turn-1',
      startedTime: 1_000,
      completedTime: 2_000,
      activeDurationMs: 800,
      usage: {
        inputTokens: 820,
        cachedInputTokens: 600,
        outputTokens: 90,
        reasoningTokens: 30,
        totalTokens: 910,
      },
    });
    const threadInput = (
      createThread.mock.calls as unknown as Array<
        Parameters<CodexRuntimeServiceApi['createThread']>
      >
    )[0][0];
    const profileId = threadInput.permissions;
    expect(typeof profileId).toBe('string');
    if (typeof profileId !== 'string') {
      throw new Error('Expected a Codex thread permission profile');
    }
    expect(profileId).toMatch(/^lc-generation-[a-f0-9]{24}$/u);
    expect(threadInput.permissions).toBe(profileId);
    expect(threadInput).toEqual(
      expect.objectContaining({
        cwd: request.workspaces.primary.path,
        runtimeWorkspaceRoots: [request.workspaces.primary.path],
        approvalPolicy: 'never',
        developerInstructions: expect.stringContaining(
          request.systemInstruction,
        ),
        configOverrides: expect.objectContaining({
          agents: { enabled: false },
          allow_login_shell: false,
          apps: { _default: { enabled: false } },
          features: expect.objectContaining({
            apps: false,
            hooks: false,
            memories: false,
            multi_agent: false,
            shell_tool: true,
          }),
          tools: { view_image: true },
          web_search: 'disabled',
          'mcp_servers.user-mcp.enabled': false,
          skills: {
            config: [
              {
                path: resolve(
                  'user-skills',
                  'user-skill',
                  'SKILL.md',
                ),
                enabled: false,
              },
            ],
          },
          permissions: {
            [profileId]: {
              filesystem: {
                ':minimal': 'read',
                [request.workspaces.primary.path]: 'read',
              },
              network: { enabled: false },
            },
          },
        }),
      }),
    );
    expect(threadInput.configOverrides).not.toHaveProperty(
      'default_permissions',
    );
    const turnInput = (
      startTurn.mock.calls as unknown as Array<
        Parameters<CodexRuntimeServiceApi['startTurn']>
      >
    )[0][0];
    expect(turnInput.threadId).toBe('thread-1');
    expect(turnInput.clientUserMessageId).toMatch(/^lc-generation-/u);
    expect(turnInput.permissions).toBeUndefined();
    expect(turnInput.outputSchema).toBeUndefined();
    expect(sessions.getBinding()).toEqual(
      expect.objectContaining({
        sessionId: 'thread-1',
        configurationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it('recovers a completed turn without consuming another model call', async () => {
    const sessions = createSessions();
    let clientUserMessageId = '';
    const startTurn = vi.fn(async function* (input) {
      yield* [];
      clientUserMessageId = input.clientUserMessageId!;
      return {
        threadId: 'thread-1',
        turn: completedTurn(clientUserMessageId),
      };
    });
    const selectThread = vi.fn(async () =>
      selection('thread-1', [completedTurn(clientUserMessageId, { ok: false })]),
    );
    const runtime = createRuntime({
      getAccount: vi.fn(async () => ({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      })),
      listMcpServers: vi.fn(async () => ({ data: [], nextCursor: null })),
      createThread: vi.fn(async () => selection('thread-1')),
      selectThread,
      startTurn,
      interruptTurn: vi.fn(async () => undefined),
    });
    const provider = new CodexAgentProvider(runtime, sessions.service, {
      now: () => 4_000,
    });
    const request = createGenerationRequest();

    await collectTurn(provider.runTurn(request));
    startTurn.mockClear();
    const recovered = await collectTurn(provider.runTurn(request));

    expect(selectThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-1', excludeTurns: false }),
    );
    expect(startTurn).not.toHaveBeenCalled();
    expect(recovered.events).toEqual([
      { type: 'session-resolved', sessionId: 'thread-1' },
    ]);
    expect(recovered.result.providerExecutionId).toBe('turn-1');
  });

  it('replaces a bound thread when immutable execution configuration changes', async () => {
    const sessions = createSessions({
      sessionId: 'thread-old',
      configurationFingerprint: 'outdated',
      createdTime: 1,
    });
    const runtime = createRuntime({
      getAccount: vi.fn(async () => ({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      })),
      listMcpServers: vi.fn(async () => ({ data: [], nextCursor: null })),
      createThread: vi.fn(async () => selection('thread-new')),
      startTurn: vi.fn(async function* (input) {
        yield* [];
        return {
          threadId: input.threadId,
          turn: completedTurn(input.clientUserMessageId!),
        };
      }),
      interruptTurn: vi.fn(async () => undefined),
    });
    const provider = new CodexAgentProvider(runtime, sessions.service);

    await collectTurn(provider.runTurn(createGenerationRequest()));

    expect(sessions.service.replaceProviderBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSessionId: 'thread-old',
        sessionId: 'thread-new',
        providerId: 'codex',
      }),
    );
    expect(sessions.getBinding()?.sessionId).toBe('thread-new');
  });

  it('replaces only an explicitly missing persisted Codex thread', async () => {
    const sessions = createSessions();
    const createThread = vi
      .fn()
      .mockResolvedValueOnce(selection('thread-old'))
      .mockResolvedValueOnce(selection('thread-new'));
    const runtime = createRuntime({
      getAccount: vi.fn(async () => ({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      })),
      listMcpServers: vi.fn(async () => ({ data: [], nextCursor: null })),
      createThread,
      selectThread: vi.fn(async () => {
        throw new AppError('CODEX_REQUEST_FAILED', {
          cause: new CodexRpcError(
            -32_600,
            'no rollout found for thread id thread-old',
          ),
        });
      }),
      startTurn: vi.fn(async function* (input) {
        yield* [];
        return {
          threadId: input.threadId,
          turn: completedTurn(input.clientUserMessageId!),
        };
      }),
      interruptTurn: vi.fn(async () => undefined),
    });
    const provider = new CodexAgentProvider(runtime, sessions.service);
    const request = createGenerationRequest();

    await collectTurn(provider.runTurn(request));
    await collectTurn(provider.runTurn(request));

    expect(sessions.service.replaceProviderBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSessionId: 'thread-old',
        sessionId: 'thread-new',
      }),
    );
  });

  it('does not replace a thread after a transient resume failure', async () => {
    const sessions = createSessions();
    const createThread = vi.fn(async () => selection('thread-1'));
    const selectThread = vi.fn(async () => {
      throw new AppError('CODEX_REQUEST_FAILED', {
        cause: new CodexRpcError(-32_000, 'connection temporarily closed'),
      });
    });
    const runtime = createRuntime({
      getAccount: vi.fn(async () => ({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      })),
      createThread,
      selectThread,
      startTurn: vi.fn(async function* (input) {
        yield* [];
        return {
          threadId: input.threadId,
          turn: completedTurn(input.clientUserMessageId!),
        };
      }),
      interruptTurn: vi.fn(async () => undefined),
    });
    const provider = new CodexAgentProvider(runtime, sessions.service);
    const request = createGenerationRequest();

    await collectTurn(provider.runTurn(request));
    await expect(collectTurn(provider.runTurn(request))).rejects.toThrow(
      'CODEX_REQUEST_FAILED',
    );

    expect(createThread).toHaveBeenCalledTimes(1);
    expect(sessions.service.replaceProviderBinding).not.toHaveBeenCalled();
  });

  it('serializes turns that share one workspace session', async () => {
    const sessions = createSessions();
    let releaseFirstTurn: () => void = () => undefined;
    const firstTurnGate = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });
    let turnNumber = 0;
    const startTurn = vi.fn(async function* (input) {
      yield* [];
      turnNumber += 1;

      if (turnNumber === 1) {
        await firstTurnGate;
      }

      return {
        threadId: input.threadId,
        turn: completedTurn(input.clientUserMessageId!),
      };
    });
    const runtime = createRuntime({
      getAccount: vi.fn(async () => ({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      })),
      createThread: vi.fn(async () => selection('thread-shared')),
      selectThread: vi.fn(async () => selection('thread-shared')),
      startTurn,
      interruptTurn: vi.fn(async () => undefined),
    });
    const provider = new CodexAgentProvider(runtime, sessions.service);
    const baseRequest = createGenerationRequest();
    const sharedWorkspace = {
      ...baseRequest.workspaces.primary,
      scope: 'shared' as const,
      instanceKey: 'shared',
    };
    const sharedLocator = {
      ...baseRequest.sessionLocator,
      instanceKey: 'shared',
    };
    const firstRun = collectTurn(
      provider.runTurn({
        ...baseRequest,
        sessionLocator: sharedLocator,
        workspaces: { primary: sharedWorkspace, secondary: [] },
      }),
    );
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledTimes(1));
    const secondRun = collectTurn(
      provider.runTurn({
        ...baseRequest,
        taskId: 'task-2',
        sessionLocator: sharedLocator,
        workspaces: { primary: sharedWorkspace, secondary: [] },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(startTurn).toHaveBeenCalledTimes(1);
    releaseFirstTurn();
    await firstRun;
    await secondRun;
    expect(startTurn).toHaveBeenCalledTimes(2);
  });

  it('exposes a registered Provider default tool without a TaskDefinition declaration', async () => {
    const functionTools = new AgentFunctionToolRegistry();
    functionTools.register({
      id: 'inspect_media',
      version: 1,
      description: 'Inspect media prepared in the task workspace.',
      inputSchema: { type: 'object' },
      deferLoading: true,
      execute: vi.fn(async () => null),
    });
    const createThread = vi.fn(async () => selection('thread-1'));
    const runtime = createRuntime({
      getAccount: vi.fn(async () => ({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      })),
      createThread,
      startTurn: vi.fn(async function* () {
        yield {
          type: 'turn-started' as const,
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'inProgress' },
        };
        return {
          threadId: 'thread-1',
          turn: completedTurn('unused'),
        };
      }),
      interruptTurn: vi.fn(async () => undefined),
    });
    const provider = new CodexAgentProvider(
      runtime,
      createSessions().service,
      {
        functionTools,
        defaultTools: [
          { id: 'inspect_media', availability: 'required' },
        ],
      },
    );

    await collectTurn(provider.runTurn(createGenerationRequest()));

    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        dynamicTools: [
          expect.objectContaining({
            type: 'namespace',
            tools: expect.arrayContaining([
              expect.objectContaining({
                name: 'inspect_media',
                deferLoading: true,
              }),
            ]),
          }),
        ],
      }),
    );
  });

  it('registers and dispatches a Function Tool without owning the Agent Loop', async () => {
    const execute = vi.fn(async () => ({ text: 'selected content' } as const));
    const functionTools = new AgentFunctionToolRegistry();
    functionTools.register({
      id: 'read_asset_anchor',
      version: 1,
      description: 'Read one selected asset anchor.',
      inputSchema: {
        type: 'object',
        properties: { assetId: { type: 'string' } },
        required: ['assetId'],
        additionalProperties: false,
      },
      execute,
    });
    const createThread = vi.fn(async () => selection('thread-1'));
    const respondToServerRequest = vi.fn(async () => undefined);
    const startTurn = vi.fn(async function* () {
      yield {
        type: 'turn-started' as const,
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'inProgress' },
      };
      yield {
        type: 'item-started' as const,
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'call-1',
          type: 'dynamicToolCall',
          namespace: CODEX_FUNCTION_TOOL_NAMESPACE,
          tool: 'read_asset_anchor',
          arguments: { assetId: 'asset-1' },
          status: 'inProgress',
        },
      };
      yield {
        type: 'server-request' as const,
        threadId: 'thread-1',
        turnId: 'turn-1',
        request: {
          requestId: 'request-1',
          method: 'item/tool/call',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            callId: 'call-1',
            namespace: CODEX_FUNCTION_TOOL_NAMESPACE,
            tool: 'read_asset_anchor',
            arguments: { assetId: 'asset-1' },
          },
        },
      };
      yield {
        type: 'item-completed' as const,
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'call-1',
          type: 'dynamicToolCall',
          namespace: CODEX_FUNCTION_TOOL_NAMESPACE,
          tool: 'read_asset_anchor',
          arguments: { assetId: 'asset-1' },
          status: 'completed',
          success: true,
        },
      };
      return {
        threadId: 'thread-1',
        turn: completedTurn('unused'),
      };
    });
    const runtime = createRuntime({
      getAccount: vi.fn(async () => ({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      })),
      createThread,
      startTurn,
      respondToServerRequest,
      interruptTurn: vi.fn(async () => undefined),
    });
    const provider = new CodexAgentProvider(
      runtime,
      createSessions().service,
      { functionTools },
    );
    const request = createGenerationRequest({
      toolRequirements: [
        { id: 'read_asset_anchor', availability: 'required' },
      ],
    });

    const { events } = await collectTurn(provider.runTurn(request));

    expect(events).toEqual([
      { type: 'session-resolved', sessionId: 'thread-1' },
      expect.objectContaining({
        type: 'tool-call',
        phase: 'started',
        toolName: 'dynamic:read_asset_anchor',
      }),
      expect.objectContaining({
        type: 'tool-call',
        phase: 'completed',
        toolName: 'dynamic:read_asset_anchor',
      }),
    ]);
    expect(execute).toHaveBeenCalledWith(
      { assetId: 'asset-1' },
      expect.objectContaining({
        taskId: 'task-1',
        projectId: 'project',
        workspaces: request.workspaces,
      }),
    );
    expect(respondToServerRequest).toHaveBeenCalledWith('request-1', {
      result: {
        contentItems: [
          { type: 'inputText', text: '{"text":"selected content"}' },
        ],
        success: true,
      },
    });
    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        dynamicTools: [
          expect.objectContaining({
            type: 'namespace',
            name: CODEX_FUNCTION_TOOL_NAMESPACE,
          }),
        ],
      }),
    );
  });

  it('injects application Skills and lets Codex execute selected MCP servers', async () => {
    const skillPath = resolve('app-skills', 'pdf-reading', 'SKILL.md');
    const createThread = vi.fn(async () => selection('thread-1'));
    const startTurn = vi.fn(async function* () {
      yield {
        type: 'turn-started' as const,
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'inProgress' },
      };
      yield {
        type: 'item-started' as const,
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'mcp-1',
          type: 'mcpToolCall',
          server: 'learning_companion_document-tools',
          tool: 'read_document',
          arguments: { path: 'lesson.pdf' },
          status: 'inProgress',
        },
      };
      yield {
        type: 'item-completed' as const,
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'mcp-1',
          type: 'mcpToolCall',
          server: 'learning_companion_document-tools',
          tool: 'read_document',
          arguments: { path: 'lesson.pdf' },
          status: 'completed',
        },
      };
      return {
        threadId: 'thread-1',
        turn: completedTurn('unused'),
      };
    });
    const runtime = createRuntime({
      getAccount: vi.fn(async () => ({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      })),
      readConfig: vi.fn(async () => ({
        config: {
          mcp_servers: {
            'ambient-server': { command: 'ambient-server' },
          },
        },
      })),
      createThread,
      startTurn,
      interruptTurn: vi.fn(async () => undefined),
    });
    const provider = new CodexAgentProvider(
      runtime,
      createSessions().service,
      {
        skills: {
          get: vi.fn(async () => ({
            id: 'pdf-reading',
            version: 1,
            description: 'Read PDF files efficiently.',
            directoryPath: resolve('app-skills', 'pdf-reading'),
            skillFilePath: skillPath,
          })),
        },
        mcpServers: {
          get: vi.fn(async () => ({
            id: 'document-tools',
            version: 1,
            description: 'Document utilities.',
            transport: {
              type: 'stdio' as const,
              command: 'document-mcp',
            },
            enabledTools: ['read_document'],
          })),
        },
      },
    );
    const request = createGenerationRequest({
      skills: [{ id: 'pdf-reading', availability: 'required' }],
      mcpServers: [{ id: 'document-tools', availability: 'required' }],
    });

    const { events } = await collectTurn(provider.runTurn(request));

    expect(events).toEqual([
      { type: 'session-resolved', sessionId: 'thread-1' },
      expect.objectContaining({
        type: 'tool-call',
        phase: 'started',
        toolName: 'mcp:document-tools/read_document',
      }),
      expect.objectContaining({
        type: 'tool-call',
        phase: 'completed',
        toolName: 'mcp:document-tools/read_document',
      }),
    ]);
    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        configOverrides: expect.objectContaining({
          'mcp_servers.ambient-server.enabled': false,
          mcp_servers: {
            'learning_companion_document-tools': expect.objectContaining({
              enabled: true,
              required: true,
              command: 'document-mcp',
              enabled_tools: ['read_document'],
            }),
          },
        }),
      }),
    );
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [
          { type: 'text', text: '$pdf-reading' },
          { type: 'skill', name: 'pdf-reading', path: skillPath },
          { type: 'text', text: 'Read sources and respond.' },
        ],
      }),
    );
  });

  it('fails closed if Codex reports an undeclared tool call', async () => {
    const sessions = createSessions();
    const runtime = createRuntime({
      getAccount: vi.fn(async () => ({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      })),
      createThread: vi.fn(async () => selection('thread-1')),
      startTurn: vi.fn(async function* () {
        yield {
          type: 'turn-started' as const,
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'inProgress' },
        };
        yield {
          type: 'item-started' as const,
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: {
            id: 'mcp-1',
            type: 'mcpToolCall',
            server: 'unexpected',
            tool: 'read',
          },
        };
        return {
          threadId: 'thread-1',
          turn: completedTurn('unused'),
        };
      }),
      interruptTurn: vi.fn(async () => undefined),
    });
    const provider = new CodexAgentProvider(runtime, sessions.service);

    await expect(
      collectTurn(provider.runTurn(createGenerationRequest())),
    ).rejects.toThrow('CODEX_PROTOCOL_ERROR');
  });

  it('fails before creating a thread when a required tool is unsupported', async () => {
    const sessions = createSessions();
    const createThread = vi.fn();
    const runtime = createRuntime({
      getAccount: vi.fn(async () => ({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
      })),
      listMcpServers: vi.fn(async () => ({ data: [], nextCursor: null })),
      createThread,
    });
    const provider = new CodexAgentProvider(runtime, sessions.service);
    const generator = provider.runTurn(
      createGenerationRequest({
        toolRequirements: [
          { id: 'database.write', availability: 'required' },
        ],
      }),
    );

    await expect(generator.next()).rejects.toThrow('FEATURE_NOT_SUPPORTED');
    expect(createThread).not.toHaveBeenCalled();
    expect(runtime.readConfig).not.toHaveBeenCalled();
    expect(runtime.listSkills).not.toHaveBeenCalled();
  });

  it('fails before account and environment access when a required Skill or MCP definition is missing', async () => {
    const createThread = vi.fn();
    const runtime = createRuntime({ createThread });
    const provider = new CodexAgentProvider(runtime, createSessions().service);
    const generator = provider.runTurn(
      createGenerationRequest({
        skills: [{ id: 'missing-skill', availability: 'required' }],
      }),
    );

    await expect(generator.next()).rejects.toThrow('FEATURE_NOT_SUPPORTED');
    expect(runtime.getAccount).not.toHaveBeenCalled();
    expect(runtime.readConfig).not.toHaveBeenCalled();
    expect(runtime.listSkills).not.toHaveBeenCalled();
    expect(createThread).not.toHaveBeenCalled();
  });
});

function requestWorkspacePath(): string {
  return resolve('test-fixtures', 'generation-mindmap');
}
