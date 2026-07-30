import { AppError } from '../../errors/app-error';
import {
  CodexAppServerApi,
  type CodexAppServerRequester,
} from './codex-app-server-api';
import type { CodexAppServerConnectionFactoryApi } from './codex-app-server-process';
import type {
  CodexRpcConnectionApi,
  CodexRpcIncomingEvent,
} from './codex-rpc-connection';
import { toTurnParams } from './codex-runtime-params';
import type { CodexRuntimeServiceApi } from './codex-runtime-service-api';
import type {
  CodexAccountState,
  CodexLoginChallenge,
  CodexMcpServerPage,
  CodexModelPage,
  CodexRpcId,
  CodexRuntimeEvent,
  CodexRuntimeSnapshot,
  CodexServerRequest,
  CodexSkillsByDirectory,
  CodexThread,
  CodexThreadPage,
  CodexThreadSelection,
  CodexTurnEvent,
  CodexTurnResult,
  CreateCodexThreadInput,
  InterruptCodexTurnInput,
  ListCodexThreadsInput,
  SelectCodexThreadInput,
  StartCodexTurnInput,
} from './codex-runtime-types';
import {
  isRecord,
  optionalThreadId,
  requireNonEmptyString,
  requireTurn,
} from './codex-runtime-validation';
import { CodexTurnStream } from './codex-turn-stream';

export type { CodexRuntimeServiceApi } from './codex-runtime-service-api';

const INITIALIZE_TIMEOUT_MS = 30_000;

export interface CodexRuntimeServiceDependencies {
  readonly clientInfo: {
    readonly name: string;
    readonly title: string;
    readonly version: string;
  };
  readonly logger: Pick<Console, 'warn'>;
}

export class CodexRuntimeService
  implements CodexRuntimeServiceApi
{
  private readonly listeners = new Set<
    (event: CodexRuntimeEvent) => void
  >();
  private readonly activeTurns = new Map<string, CodexTurnStream>();
  private readonly dependencies: CodexRuntimeServiceDependencies;
  private readonly appServerApi: CodexAppServerApi;
  private snapshot: CodexRuntimeSnapshot = Object.freeze({
    phase: 'stopped',
  });
  private connection: CodexRpcConnectionApi | undefined;
  private disposeConnectionEvents: (() => void) | undefined;
  private startTask: Promise<CodexRpcConnectionApi> | undefined;
  private shutdownTask: Promise<void> | undefined;
  private connectionGeneration = 0;

  constructor(
    private readonly connectionFactory:
      CodexAppServerConnectionFactoryApi,
    dependencies: Partial<CodexRuntimeServiceDependencies> = {},
  ) {
    this.dependencies = {
      clientInfo: dependencies.clientInfo ?? {
        name: 'learning_companion',
        title: 'Learning Companion',
        version: '0.1.0',
      },
      logger: dependencies.logger ?? console,
    };
    const requester: CodexAppServerRequester = <TResult>(
      method: string,
      params?: unknown,
    ) => this.request<TResult>(method, params);
    this.appServerApi = new CodexAppServerApi(requester);
  }

  getSnapshot(): CodexRuntimeSnapshot {
    return this.snapshot;
  }

  subscribe(
    listener: (event: CodexRuntimeEvent) => void,
  ): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async ensureReady(): Promise<CodexRuntimeSnapshot> {
    await this.requireConnection();
    return this.snapshot;
  }

  getAccount(refreshToken = false): Promise<CodexAccountState> {
    return this.appServerApi.getAccount(refreshToken);
  }

  startChatGptLogin(
    flow: 'browser' | 'device-code' = 'browser',
  ): Promise<CodexLoginChallenge> {
    return this.appServerApi.startChatGptLogin(flow);
  }

  cancelLogin(loginId: string): Promise<void> {
    return this.appServerApi.cancelLogin(loginId);
  }

  logout(): Promise<void> {
    return this.appServerApi.logout();
  }

  listModels(
    input: {
      readonly cursor?: string;
      readonly limit?: number;
      readonly includeHidden?: boolean;
    } = {},
  ): Promise<CodexModelPage> {
    return this.appServerApi.listModels(input);
  }

  getRateLimits(): Promise<unknown> {
    return this.appServerApi.getRateLimits();
  }

  listSkills(
    cwds: readonly string[],
    forceReload = false,
  ): Promise<readonly CodexSkillsByDirectory[]> {
    return this.appServerApi.listSkills(cwds, forceReload);
  }

  listMcpServers(
    input: {
      readonly cursor?: string;
      readonly limit?: number;
      readonly threadId?: string;
      readonly detail?: 'full' | 'toolsAndAuthOnly';
    } = {},
  ): Promise<CodexMcpServerPage> {
    return this.appServerApi.listMcpServers(input);
  }

  reloadMcpServers(): Promise<void> {
    return this.appServerApi.reloadMcpServers();
  }

  createThread(
    input: CreateCodexThreadInput,
  ): Promise<CodexThreadSelection> {
    return this.appServerApi.createThread(input);
  }

  listThreads(
    input: ListCodexThreadsInput = {},
  ): Promise<CodexThreadPage> {
    return this.appServerApi.listThreads(input);
  }

  selectThread(
    input: SelectCodexThreadInput,
  ): Promise<CodexThreadSelection> {
    return this.appServerApi.selectThread(input);
  }

  readThread(
    threadId: string,
    includeTurns = false,
  ): Promise<CodexThread> {
    return this.appServerApi.readThread(threadId, includeTurns);
  }

  async *startTurn(
    input: StartCodexTurnInput,
  ): AsyncGenerator<CodexTurnEvent, CodexTurnResult> {
    const threadId = requireNonEmptyString(
      input.threadId,
      'threadId',
    );

    if (this.activeTurns.has(threadId)) {
      throw new AppError('CODEX_TURN_ACTIVE');
    }

    const stream = new CodexTurnStream(threadId);
    this.activeTurns.set(threadId, stream);
    let connection: CodexRpcConnectionApi | undefined;
    let shouldInterrupt = true;

    try {
      connection = await this.requireConnection();
      const result = await this.requestOnConnection<unknown>(
        connection,
        'turn/start',
        toTurnParams(input),
      );

      if (!isRecord(result)) {
        throw new AppError('CODEX_PROTOCOL_ERROR');
      }

      const turn = requireTurn(result.turn);
      stream.start(turn);

      while (true) {
        const next = await stream.next();

        if (next.done) {
          shouldInterrupt = false;
          return next.value;
        }

        yield next.value;
      }
    } finally {
      if (this.activeTurns.get(threadId) === stream) {
        this.activeTurns.delete(threadId);
      }

      const turnId = stream.activeTurnId;

      if (
        shouldInterrupt &&
        turnId &&
        !stream.isCompleted &&
        connection !== undefined &&
        this.connection === connection &&
        this.snapshot.phase === 'ready'
      ) {
        await this.requestOnConnection(
          connection,
          'turn/interrupt',
          { threadId, turnId },
        ).catch(
          (error: unknown) => {
            this.dependencies.logger.warn(
              '提前结束 Codex Turn 流时中断失败',
              error,
            );
          },
        );
      }
    }
  }

  interruptTurn(
    input: InterruptCodexTurnInput,
  ): Promise<void> {
    return this.appServerApi.interruptTurn(input);
  }

  async respondToServerRequest(
    requestId: CodexRpcId,
    response:
      | { readonly result: unknown }
      | {
          readonly error: {
            readonly code: number;
            readonly message: string;
            readonly data?: unknown;
          };
        },
  ): Promise<void> {
    const connection = await this.requireConnection();

    if ('result' in response) {
      await connection.respond(requestId, response.result);
      return;
    }

    await connection.respondError(requestId, response.error);
  }

  shutdown(): Promise<void> {
    if (this.shutdownTask) {
      return this.shutdownTask;
    }

    const task = this.performShutdown();
    const trackedTask = task.finally(() => {
      if (this.shutdownTask === trackedTask) {
        this.shutdownTask = undefined;
      }
    });
    this.shutdownTask = trackedTask;
    return trackedTask;
  }

  private async performShutdown(): Promise<void> {
    if (
      this.snapshot.phase === 'stopped' &&
      !this.connection &&
      !this.startTask
    ) {
      return;
    }

    this.setSnapshot({ phase: 'stopping' });
    const pendingStart = this.startTask;

    if (pendingStart) {
      await pendingStart.catch(() => undefined);
    }

    const connection = this.connection;
    this.connection = undefined;
    this.disposeConnectionEvents?.();
    this.disposeConnectionEvents = undefined;

    if (connection) {
      await connection.close().catch((error: unknown) => {
        this.dependencies.logger.warn(
          '关闭 Codex Runtime 失败',
          error,
        );
      });
    }

    const error = new AppError('CODEX_RUNTIME_UNAVAILABLE');
    for (const stream of this.activeTurns.values()) {
      stream.fail(error);
    }
    this.activeTurns.clear();
    this.setSnapshot({ phase: 'stopped' });
  }

  private requireConnection(): Promise<CodexRpcConnectionApi> {
    if (this.connection && this.snapshot.phase === 'ready') {
      return Promise.resolve(this.connection);
    }

    if (this.startTask) {
      return this.startTask;
    }

    if (this.snapshot.phase === 'stopping') {
      return Promise.reject(
        new AppError('CODEX_RUNTIME_UNAVAILABLE'),
      );
    }

    const task = this.startConnection();
    const trackedTask = task.finally(() => {
      if (this.startTask === trackedTask) {
        this.startTask = undefined;
      }
    });
    this.startTask = trackedTask;
    return trackedTask;
  }

  private async startConnection(): Promise<CodexRpcConnectionApi> {
    this.setSnapshot({ phase: 'starting' });
    const generation = this.connectionGeneration + 1;
    this.connectionGeneration = generation;
    let connection: CodexRpcConnectionApi | undefined;

    try {
      connection = await this.connectionFactory.connect();
      this.connection = connection;
      this.disposeConnectionEvents = connection.subscribe((event) => {
        this.handleRpcEvent(event);
      });
      void connection.closed.then((result) => {
        this.handleConnectionClosed(generation, connection!, result);
      });
      await connection.request(
        'initialize',
        {
          clientInfo: this.dependencies.clientInfo,
          capabilities: {
            experimentalApi: true,
            mcpServerOpenaiFormElicitation: true,
          },
        },
        INITIALIZE_TIMEOUT_MS,
      );
      await connection.notify('initialized', {});

      if (
        this.connection !== connection ||
        this.snapshot.phase === 'stopping'
      ) {
        throw new AppError('CODEX_RUNTIME_UNAVAILABLE');
      }

      this.setSnapshot({ phase: 'ready' });
      return connection;
    } catch (error) {
      if (this.connection === connection) {
        this.connection = undefined;
      }
      this.disposeConnectionEvents?.();
      this.disposeConnectionEvents = undefined;
      await connection?.close().catch(() => undefined);

      const wrapped =
        error instanceof AppError
          ? error
          : new AppError('CODEX_RUNTIME_UNAVAILABLE', {
              cause: error,
            });
      if (this.snapshot.phase !== 'stopping') {
        this.setSnapshot({
          phase: 'failed',
          failure: { message: wrapped.message },
        });
      }
      throw wrapped;
    }
  }

  private handleConnectionClosed(
    generation: number,
    connection: CodexRpcConnectionApi,
    result: {
      readonly error?: Error;
      readonly stderr: string;
    },
  ): void {
    if (
      generation !== this.connectionGeneration ||
      this.connection !== connection
    ) {
      return;
    }

    this.connection = undefined;
    this.disposeConnectionEvents?.();
    this.disposeConnectionEvents = undefined;
    const error = new AppError('CODEX_RUNTIME_UNAVAILABLE', {
      cause:
        result.error ??
        new Error(
          result.stderr || 'Codex app-server connection closed',
        ),
    });

    for (const stream of this.activeTurns.values()) {
      stream.fail(error);
    }
    this.activeTurns.clear();

    if (this.snapshot.phase !== 'stopping') {
      this.setSnapshot({
        phase: 'failed',
        failure: { message: error.message },
      });
    }
  }

  private handleRpcEvent(event: CodexRpcIncomingEvent): void {
    const threadId = optionalThreadId(event.params);
    const stream = threadId
      ? this.activeTurns.get(threadId)
      : undefined;
    const consumed = stream?.accept(event) ?? false;

    if (event.type === 'notification') {
      if (!consumed) {
        this.emit({
          type: 'notification',
          notification: {
            method: event.method,
            params: event.params,
          },
        });
      }
      return;
    }

    if (!consumed) {
      const request: CodexServerRequest = {
        requestId: event.id,
        method: event.method,
        params: event.params,
      };
      this.emit({ type: 'unmatched-server-request', request });
    }
  }

  private async request<TResult>(
    method: string,
    params?: unknown,
  ): Promise<TResult> {
    const connection = await this.requireConnection();
    return this.requestOnConnection(connection, method, params);
  }

  private async requestOnConnection<TResult>(
    connection: CodexRpcConnectionApi,
    method: string,
    params?: unknown,
  ): Promise<TResult> {
    try {
      return await connection.request<TResult>(method, params);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('CODEX_REQUEST_FAILED', { cause: error });
    }
  }

  private setSnapshot(snapshot: CodexRuntimeSnapshot): void {
    this.snapshot = Object.freeze(snapshot);
    this.emit({ type: 'state-changed', snapshot: this.snapshot });
  }

  private emit(event: CodexRuntimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
