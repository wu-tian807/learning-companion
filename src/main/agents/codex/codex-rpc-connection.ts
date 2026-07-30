import type {
  ChildProcess,
  ChildProcessByStdio,
} from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import type { CodexRpcId } from './codex-runtime-types';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface CodexRpcNotification {
  readonly type: 'notification';
  readonly method: string;
  readonly params: unknown;
}

export interface CodexRpcServerRequest {
  readonly type: 'server-request';
  readonly id: CodexRpcId;
  readonly method: string;
  readonly params: unknown;
}

export type CodexRpcIncomingEvent =
  | CodexRpcNotification
  | CodexRpcServerRequest;

export interface CodexConnectionClose {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
  readonly stderr: string;
}

export interface CodexRpcConnectionApi {
  readonly closed: Promise<CodexConnectionClose>;

  request<TResult>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<TResult>;
  notify(method: string, params?: unknown): Promise<void>;
  respond(requestId: CodexRpcId, result: unknown): Promise<void>;
  respondError(
    requestId: CodexRpcId,
    error: {
      readonly code: number;
      readonly message: string;
      readonly data?: unknown;
    },
  ): Promise<void>;
  subscribe(
    listener: (event: CodexRpcIncomingEvent) => void,
  ): () => void;
  close(): Promise<void>;
}

export interface CodexProcessTerminatorApi {
  terminate(child: ChildProcess, force: boolean): void;
}

type CodexChildProcess = ChildProcessByStdio<
  Writable,
  Readable,
  Readable
>;

export class CodexRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'CodexRpcError';
  }
}

export class CodexConnectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CodexConnectionError';
  }
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface CodexJsonRpcConnectionDependencies {
  readonly requestTimeoutMs: number;
  readonly stderrLimit: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRpcId(value: unknown): value is CodexRpcId {
  return typeof value === 'number' || typeof value === 'string';
}

function requireMethod(method: string): string {
  const normalized = method.trim();

  if (normalized.length === 0) {
    throw new CodexConnectionError('Codex RPC method cannot be empty');
  }

  return normalized;
}

function requireTimeout(timeoutMs: number): number {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CodexConnectionError(
      'Codex RPC timeout must be a positive integer',
    );
  }

  return timeoutMs;
}

function appendLimited(
  current: string,
  content: string,
  limit: number,
): string {
  return `${current}${content}`.slice(-limit);
}

export class CodexJsonRpcConnection
  implements CodexRpcConnectionApi
{
  readonly closed: Promise<CodexConnectionClose>;

  private readonly pending = new Map<CodexRpcId, PendingRequest>();
  private readonly listeners = new Set<
    (event: CodexRpcIncomingEvent) => void
  >();
  private readonly dependencies: CodexJsonRpcConnectionDependencies;
  private readonly resolveClosed: (
    result: CodexConnectionClose,
  ) => void;
  private nextRequestId = 1;
  private stderr = '';
  private fatalError: Error | undefined;
  private closeRequested = false;
  private didClose = false;

  constructor(
    private readonly child: CodexChildProcess,
    private readonly terminator: CodexProcessTerminatorApi,
    dependencies: Partial<CodexJsonRpcConnectionDependencies> = {},
  ) {
    this.dependencies = {
      requestTimeoutMs:
        dependencies.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      stderrLimit: dependencies.stderrLimit ?? 64 * 1024,
    };

    let resolveClosed:
      | ((result: CodexConnectionClose) => void)
      | undefined;
    this.closed = new Promise<CodexConnectionClose>((resolve) => {
      resolveClosed = resolve;
    });
    this.resolveClosed = (result) => resolveClosed?.(result);

    child.stdin.setDefaultEncoding('utf8');
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (content: string) => {
      this.stderr = appendLimited(
        this.stderr,
        content,
        this.dependencies.stderrLimit,
      );
    });

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      this.handleLine(line);
    });
    child.once('error', (error) => {
      this.handleClosed(null, null, error);
    });
    child.once('close', (code, signal) => {
      lines.close();
      this.handleClosed(code, signal);
    });
  }

  request<TResult>(
    method: string,
    params?: unknown,
    timeoutMs = this.dependencies.requestTimeoutMs,
  ): Promise<TResult> {
    if (this.didClose || this.closeRequested) {
      return Promise.reject(
        new CodexConnectionError('Codex RPC connection is closed'),
      );
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const requestTimeout = requireTimeout(timeoutMs);

    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new CodexConnectionError(
            `Codex RPC request timed out: ${method}`,
          ),
        );
      }, requestTimeout);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timeout,
      });

      void this.write({
        id: requestId,
        method: requireMethod(method),
        params,
      }).catch((error: unknown) => {
        const pending = this.pending.get(requestId);

        if (!pending) {
          return;
        }

        clearTimeout(pending.timeout);
        this.pending.delete(requestId);
        pending.reject(error);
      });
    });
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.write({
      method: requireMethod(method),
      params,
    });
  }

  respond(requestId: CodexRpcId, result: unknown): Promise<void> {
    return this.write({ id: requestId, result });
  }

  respondError(
    requestId: CodexRpcId,
    error: {
      readonly code: number;
      readonly message: string;
      readonly data?: unknown;
    },
  ): Promise<void> {
    return this.write({
      id: requestId,
      error,
    });
  }

  subscribe(
    listener: (event: CodexRpcIncomingEvent) => void,
  ): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.didClose) {
      return;
    }

    if (!this.closeRequested) {
      this.closeRequested = true;
      this.child.stdin.end();
      this.terminator.terminate(this.child, false);
    }

    await this.closed;
  }

  private write(message: unknown): Promise<void> {
    if (this.didClose || this.closeRequested) {
      return Promise.reject(
        new CodexConnectionError('Codex RPC connection is closed'),
      );
    }

    let serialized: string;

    try {
      serialized = `${JSON.stringify(message)}\n`;
    } catch (error) {
      return Promise.reject(
        new CodexConnectionError(
          'Codex RPC message could not be serialized',
          { cause: error },
        ),
      );
    }

    return new Promise<void>((resolve, reject) => {
      this.child.stdin.write(serialized, 'utf8', (error) => {
        if (error) {
          reject(
            new CodexConnectionError(
              'Codex RPC message could not be written',
              { cause: error },
            ),
          );
          return;
        }

        resolve();
      });
    });
  }

  private handleLine(line: string): void {
    let message: unknown;

    try {
      message = JSON.parse(line);
    } catch (error) {
      this.failProtocol('Codex app-server emitted invalid JSON', error);
      return;
    }

    if (!isRecord(message)) {
      this.failProtocol('Codex app-server emitted a non-object message');
      return;
    }

    if ('method' in message) {
      if (typeof message.method !== 'string') {
        this.failProtocol('Codex app-server emitted an invalid method');
        return;
      }

      const event: CodexRpcIncomingEvent = isRpcId(message.id)
        ? {
            type: 'server-request',
            id: message.id,
            method: message.method,
            params: message.params,
          }
        : {
            type: 'notification',
            method: message.method,
            params: message.params,
          };

      for (const listener of this.listeners) {
        listener(event);
      }
      return;
    }

    if (!isRpcId(message.id)) {
      this.failProtocol(
        'Codex app-server emitted a response without an id',
      );
      return;
    }

    const pending = this.pending.get(message.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(message.id);

    if (isRecord(message.error)) {
      pending.reject(
        new CodexRpcError(
          typeof message.error.code === 'number'
            ? message.error.code
            : -32_000,
          typeof message.error.message === 'string'
            ? message.error.message
            : 'Codex RPC request failed',
          message.error.data,
        ),
      );
      return;
    }

    if (!Object.hasOwn(message, 'result')) {
      pending.reject(
        new CodexConnectionError(
          'Codex app-server response has neither result nor error',
        ),
      );
      return;
    }

    pending.resolve(message.result);
  }

  private failProtocol(message: string, cause?: unknown): void {
    if (this.fatalError) {
      return;
    }

    this.fatalError = new CodexConnectionError(message, { cause });
    this.rejectPending(this.fatalError);
    this.terminator.terminate(this.child, true);
  }

  private handleClosed(
    code: number | null,
    signal: NodeJS.Signals | null,
    error?: Error,
  ): void {
    if (this.didClose) {
      return;
    }

    this.didClose = true;
    this.closeRequested = true;
    const closeError =
      this.fatalError ??
      error ??
      (code === 0
        ? undefined
        : new CodexConnectionError(
            `Codex app-server exited with code ${String(code)} and signal ${String(signal)}`,
          ));

    if (closeError) {
      this.rejectPending(closeError);
    } else {
      this.rejectPending(
        new CodexConnectionError('Codex RPC connection closed'),
      );
    }

    this.listeners.clear();
    this.resolveClosed({
      code,
      signal,
      error: closeError,
      stderr: this.stderr,
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
