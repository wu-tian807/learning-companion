import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { CodexAppServerConnectionFactoryApi } from './codex-app-server-process';
import type {
  CodexConnectionClose,
  CodexRpcConnectionApi,
  CodexRpcIncomingEvent,
} from './codex-rpc-connection';
import { CodexRuntimeService } from './codex-runtime-service';
import type {
  CodexRpcId,
  CodexTurn,
} from './codex-runtime-types';

interface RecordedRequest {
  readonly method: string;
  readonly params: unknown;
  readonly timeoutMs?: number;
}

class FakeCodexConnection implements CodexRpcConnectionApi {
  readonly requests: RecordedRequest[] = [];
  readonly notifications: {
    readonly method: string;
    readonly params: unknown;
  }[] = [];
  readonly responses: {
    readonly requestId: CodexRpcId;
    readonly result?: unknown;
    readonly error?: unknown;
  }[] = [];
  readonly handlers = new Map<
    string,
    | unknown
    | ((
        params: unknown,
        request: RecordedRequest,
      ) => unknown | Promise<unknown>)
  >();
  readonly closed: Promise<CodexConnectionClose>;
  readonly close = vi.fn(async () => {
    this.resolveClosed({
      code: 0,
      signal: null,
      stderr: '',
    });
  });

  private readonly listeners = new Set<
    (event: CodexRpcIncomingEvent) => void
  >();
  private readonly resolveClosed: (
    result: CodexConnectionClose,
  ) => void;

  constructor() {
    let resolveClosed:
      | ((result: CodexConnectionClose) => void)
      | undefined;
    this.closed = new Promise((resolvePromise) => {
      resolveClosed = resolvePromise;
    });
    this.resolveClosed = (result) => resolveClosed?.(result);
    this.handlers.set('initialize', {});
  }

  async request<TResult>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<TResult> {
    const request = { method, params, timeoutMs };
    this.requests.push(request);
    const handler = this.handlers.get(method);

    if (typeof handler === 'function') {
      return (await handler(params, request)) as TResult;
    }

    return handler as TResult;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.notifications.push({ method, params });
  }

  async respond(requestId: CodexRpcId, result: unknown): Promise<void> {
    this.responses.push({ requestId, result });
  }

  async respondError(
    requestId: CodexRpcId,
    error: {
      readonly code: number;
      readonly message: string;
      readonly data?: unknown;
    },
  ): Promise<void> {
    this.responses.push({ requestId, error });
  }

  subscribe(
    listener: (event: CodexRpcIncomingEvent) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: CodexRpcIncomingEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  disconnect(error: Error): void {
    this.resolveClosed({
      code: 1,
      signal: null,
      error,
      stderr: error.message,
    });
  }
}

function createService() {
  const connection = new FakeCodexConnection();
  const factory: CodexAppServerConnectionFactoryApi = {
    connect: vi.fn(async () => connection),
  };
  const service = new CodexRuntimeService(factory, {
    clientInfo: {
      name: 'learning_companion_test',
      title: 'Learning Companion Test',
      version: '1.2.3',
    },
  });

  return { connection, factory, service };
}

function turn(
  id: string,
  status = 'inProgress',
): CodexTurn {
  return {
    id,
    status,
    items: [],
    error: null,
  };
}

describe('CodexRuntimeService', () => {
  it('coalesces startup and performs the app-server handshake once', async () => {
    const { connection, factory, service } = createService();
    const events: unknown[] = [];
    service.subscribe((event) => events.push(event));

    await Promise.all([service.ensureReady(), service.ensureReady()]);

    expect(factory.connect).toHaveBeenCalledOnce();
    expect(connection.requests[0]).toEqual({
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'learning_companion_test',
          title: 'Learning Companion Test',
          version: '1.2.3',
        },
        capabilities: {
          experimentalApi: true,
          mcpServerOpenaiFormElicitation: true,
        },
      },
      timeoutMs: 30_000,
    });
    expect(connection.notifications).toEqual([
      { method: 'initialized', params: {} },
    ]);
    expect(service.getSnapshot()).toEqual({ phase: 'ready' });
    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: 'state-changed',
          snapshot: { phase: 'starting' },
        },
        {
          type: 'state-changed',
          snapshot: { phase: 'ready' },
        },
      ]),
    );

    await service.shutdown();
    expect(connection.close).toHaveBeenCalledOnce();
    expect(service.getSnapshot()).toEqual({ phase: 'stopped' });
  });

  it('checks account state and starts managed ChatGPT login', async () => {
    const { connection, service } = createService();
    connection.handlers.set('account/read', {
      account: {
        type: 'chatgpt',
        email: 'learner@example.com',
        planType: 'free',
      },
      requiresOpenaiAuth: true,
    });
    connection.handlers.set('account/login/start', {
      type: 'chatgpt',
      loginId: 'login-1',
      authUrl: 'https://chatgpt.com/login',
    });
    const events: unknown[] = [];
    service.subscribe((event) => events.push(event));

    await expect(service.getAccount(true)).resolves.toEqual({
      account: {
        type: 'chatgpt',
        email: 'learner@example.com',
        planType: 'free',
      },
      requiresOpenaiAuth: true,
    });
    await expect(service.startChatGptLogin()).resolves.toEqual({
      type: 'chatgpt',
      loginId: 'login-1',
      authUrl: 'https://chatgpt.com/login',
    });
    expect(
      connection.requests.find(
        (request) => request.method === 'account/login/start',
      )?.params,
    ).toEqual({
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
      appBrand: 'chatgpt',
    });

    connection.emit({
      type: 'notification',
      method: 'account/login/completed',
      params: {
        loginId: 'login-1',
        success: true,
        error: null,
      },
    });
    expect(events).toContainEqual({
      type: 'notification',
      notification: {
        method: 'account/login/completed',
        params: {
          loginId: 'login-1',
          success: true,
          error: null,
        },
      },
    });
  });

  it('creates, lists, selects, and reads threads without leaking policy placement', async () => {
    const { connection, service } = createService();
    const workspace = resolve('test-fixtures', 'project');
    const threadValue = {
      id: 'thread-1',
      sessionId: 'thread-1',
      preview: '',
      cwd: workspace,
      status: { type: 'idle' },
    };
    const selection = {
      thread: threadValue,
      model: 'gpt-test',
      modelProvider: 'openai',
      cwd: workspace,
      instructionSources: [],
    };
    connection.handlers.set('thread/start', selection);
    connection.handlers.set('thread/list', {
      data: [threadValue],
      nextCursor: null,
      backwardsCursor: null,
    });
    connection.handlers.set('thread/resume', selection);
    connection.handlers.set('thread/read', {
      thread: threadValue,
    });

    await service.createThread({
      cwd: workspace,
      runtimeWorkspaceRoots: [workspace],
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      baseInstructions: 'Base policy',
      developerInstructions: 'Tutor policy',
      configOverrides: {
        web_search: 'disabled',
      },
      dynamicTools: [
        {
          type: 'function',
          name: 'read_asset_selection',
          description: 'Read the current selection',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    });

    expect(
      connection.requests.find(
        (request) => request.method === 'thread/start',
      )?.params,
    ).toEqual(
      expect.objectContaining({
        cwd: workspace,
        runtimeWorkspaceRoots: [workspace],
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        baseInstructions: 'Base policy',
        developerInstructions: 'Tutor policy',
        config: {
          web_search: 'disabled',
        },
        serviceName: 'learning_companion',
        dynamicTools: [
          {
            type: 'function',
            name: 'read_asset_selection',
            description: 'Read the current selection',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      }),
    );
    await expect(
      service.listThreads({ cwd: workspace }),
    ).resolves.toEqual({
      data: [threadValue],
      nextCursor: null,
      backwardsCursor: null,
    });
    await expect(
      service.selectThread({
        threadId: 'thread-1',
        cwd: workspace,
        developerInstructions: 'Updated tutor policy',
      }),
    ).resolves.toEqual(selection);
    await expect(
      service.readThread('thread-1', true),
    ).resolves.toEqual(threadValue);
  });

  it('streams assistant deltas, tool calls, requests, and completion', async () => {
    const { connection, service } = createService();
    const workspace = resolve('test-fixtures', 'project');
    connection.handlers.set('turn/start', {
      turn: turn('turn-1'),
    });
    const generator = service.startTurn({
      threadId: 'thread-1',
      input: [
        { type: 'text', text: 'Explain this selection' },
        {
          type: 'skill',
          name: 'learning-tutor',
          path: resolve(workspace, 'skills', 'learning-tutor', 'SKILL.md'),
        },
      ],
      cwd: workspace,
      runtimeWorkspaceRoots: [workspace],
      sandboxPolicy: {
        type: 'readOnly',
        networkAccess: false,
      },
    });

    await expect(generator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'turn-started',
        threadId: 'thread-1',
        turn: turn('turn-1'),
      },
    });
    expect(
      connection.requests.find(
        (request) => request.method === 'turn/start',
      )?.params,
    ).toEqual(
      expect.objectContaining({
        threadId: 'thread-1',
        input: [
          {
            type: 'text',
            text: 'Explain this selection',
            text_elements: [],
          },
          {
            type: 'skill',
            name: 'learning-tutor',
            path: resolve(
              workspace,
              'skills',
              'learning-tutor',
              'SKILL.md',
            ),
          },
        ],
        cwd: workspace,
        runtimeWorkspaceRoots: [workspace],
        sandboxPolicy: {
          type: 'readOnly',
          networkAccess: false,
        },
      }),
    );

    connection.emit({
      type: 'notification',
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'message-1',
        delta: '第一段',
      },
    });
    await expect(generator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'assistant-message-delta',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'message-1',
        delta: '第一段',
      },
    });

    const toolItem = {
      id: 'tool-item-1',
      type: 'dynamicToolCall',
      namespace: null,
      tool: 'read_asset_selection',
      arguments: {},
      status: 'inProgress',
    };
    connection.emit({
      type: 'notification',
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: toolItem,
      },
    });
    await expect(generator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'item-started',
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: toolItem,
      },
    });

    connection.emit({
      type: 'server-request',
      id: 'tool-request-1',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        callId: 'tool-item-1',
        namespace: null,
        tool: 'read_asset_selection',
        arguments: {},
      },
    });
    await expect(generator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'server-request',
        threadId: 'thread-1',
        turnId: 'turn-1',
        request: {
          requestId: 'tool-request-1',
          method: 'item/tool/call',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            callId: 'tool-item-1',
            namespace: null,
            tool: 'read_asset_selection',
            arguments: {},
          },
        },
      },
    });
    await service.respondToServerRequest('tool-request-1', {
      result: {
        contentItems: [
          { type: 'inputText', text: 'selected content' },
        ],
        success: true,
      },
    });
    expect(connection.responses).toContainEqual({
      requestId: 'tool-request-1',
      result: {
        contentItems: [
          { type: 'inputText', text: 'selected content' },
        ],
        success: true,
      },
    });

    const completedTurn = turn('turn-1', 'completed');
    connection.emit({
      type: 'notification',
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: completedTurn,
      },
    });
    await expect(generator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'turn-completed',
        threadId: 'thread-1',
        turn: completedTurn,
      },
    });
    await expect(generator.next()).resolves.toEqual({
      done: true,
      value: {
        threadId: 'thread-1',
        turn: completedTurn,
      },
    });
  });

  it('interrupts a turn when its consumer stops early', async () => {
    const { connection, service } = createService();
    connection.handlers.set('turn/start', {
      turn: turn('turn-early'),
    });
    connection.handlers.set('turn/interrupt', {});
    const generator = service.startTurn({
      threadId: 'thread-early',
      input: [{ type: 'text', text: 'Start a long task' }],
    });

    await generator.next();
    await generator.return({
      threadId: 'thread-early',
      turn: turn('turn-early', 'interrupted'),
    });

    expect(connection.requests).toContainEqual({
      method: 'turn/interrupt',
      params: {
        threadId: 'thread-early',
        turnId: 'turn-early',
      },
      timeoutMs: undefined,
    });
  });

  it('reserves a thread before startup so concurrent turns cannot race', async () => {
    const connection = new FakeCodexConnection();
    connection.handlers.set('turn/start', {
      turn: turn('turn-first'),
    });
    connection.handlers.set('turn/interrupt', {});
    let resolveConnection:
      | ((connection: CodexRpcConnectionApi) => void)
      | undefined;
    const connectionTask = new Promise<CodexRpcConnectionApi>(
      (resolvePromise) => {
        resolveConnection = resolvePromise;
      },
    );
    const factory: CodexAppServerConnectionFactoryApi = {
      connect: vi.fn(() => connectionTask),
    };
    const service = new CodexRuntimeService(factory, {
      clientInfo: {
        name: 'learning_companion_test',
        title: 'Learning Companion Test',
        version: '1.2.3',
      },
    });
    const first = service.startTurn({
      threadId: 'thread-shared',
      input: [{ type: 'text', text: 'First task' }],
    });
    const firstEvent = first.next();

    await Promise.resolve();

    const second = service.startTurn({
      threadId: 'thread-shared',
      input: [{ type: 'text', text: 'Second task' }],
    });
    const secondEvent = second.next();
    resolveConnection?.(connection);

    await expect(secondEvent).rejects.toMatchObject({
      code: 'CODEX_TURN_ACTIVE',
    });
    await expect(firstEvent).resolves.toEqual({
      done: false,
      value: {
        type: 'turn-started',
        threadId: 'thread-shared',
        turn: turn('turn-first'),
      },
    });
    await first.return({
      threadId: 'thread-shared',
      turn: turn('turn-first', 'interrupted'),
    });
  });

  it('does not restart a failed connection just to interrupt an old turn', async () => {
    const { connection, factory, service } = createService();
    connection.handlers.set('turn/start', {
      turn: turn('turn-disconnected'),
    });
    const generator = service.startTurn({
      threadId: 'thread-disconnected',
      input: [{ type: 'text', text: 'Start a task' }],
    });

    await generator.next();
    const nextEvent = generator.next();
    connection.disconnect(new Error('connection lost'));

    await expect(nextEvent).rejects.toMatchObject({
      code: 'CODEX_RUNTIME_UNAVAILABLE',
    });
    expect(factory.connect).toHaveBeenCalledOnce();
    expect(
      connection.requests.some(
        (request) => request.method === 'turn/interrupt',
      ),
    ).toBe(false);
  });
});
