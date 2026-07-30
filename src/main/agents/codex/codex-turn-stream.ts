import type { CodexRpcIncomingEvent } from './codex-rpc-connection';
import type {
  CodexTurn,
  CodexTurnEvent,
  CodexTurnResult,
} from './codex-runtime-types';
import {
  isRecord,
  optionalThreadId,
  optionalTurnId,
  requireThreadItem,
  requireTurn,
} from './codex-runtime-validation';

interface QueuedValue<T> {
  readonly value: T;
}

interface QueueWaiter<T, TResult> {
  readonly resolve: (
    result: IteratorResult<T, TResult>,
  ) => void;
  readonly reject: (error: unknown) => void;
}

function toTurnEvent(
  event: CodexRpcIncomingEvent,
  expectedThreadId: string,
): CodexTurnEvent | undefined {
  const params = event.params;
  const threadId = optionalThreadId(params);

  if (threadId !== expectedThreadId || !isRecord(params)) {
    return undefined;
  }

  if (event.type === 'server-request') {
    return {
      type: 'server-request',
      threadId,
      turnId: optionalTurnId(params),
      request: {
        requestId: event.id,
        method: event.method,
        params,
      },
    };
  }

  if (event.method === 'turn/started') {
    return {
      type: 'turn-started',
      threadId,
      turn: requireTurn(params.turn),
    };
  }

  if (event.method === 'turn/completed') {
    return {
      type: 'turn-completed',
      threadId,
      turn: requireTurn(params.turn),
    };
  }

  if (
    event.method === 'item/agentMessage/delta' &&
    typeof params.turnId === 'string' &&
    typeof params.itemId === 'string' &&
    typeof params.delta === 'string'
  ) {
    return {
      type: 'assistant-message-delta',
      threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      delta: params.delta,
    };
  }

  if (
    (event.method === 'item/started' ||
      event.method === 'item/completed') &&
    typeof params.turnId === 'string'
  ) {
    return {
      type:
        event.method === 'item/started'
          ? 'item-started'
          : 'item-completed',
      threadId,
      turnId: params.turnId,
      item: requireThreadItem(params.item),
    };
  }

  if (
    event.method === 'error' &&
    typeof params.turnId === 'string' &&
    isRecord(params.error) &&
    typeof params.error.message === 'string'
  ) {
    return {
      type: 'error',
      threadId,
      turnId: params.turnId,
      error: {
        message: params.error.message,
        codexErrorInfo: params.error.codexErrorInfo,
        additionalDetails:
          typeof params.error.additionalDetails === 'string'
            ? params.error.additionalDetails
            : null,
      },
      willRetry: params.willRetry === true,
    };
  }

  const knownType =
    event.method === 'turn/plan/updated'
      ? 'plan-updated'
      : event.method === 'turn/diff/updated'
        ? 'diff-updated'
        : event.method === 'thread/tokenUsage/updated'
          ? 'token-usage-updated'
          : event.method === 'warning' ||
              event.method === 'configWarning'
            ? 'warning'
            : 'notification';

  return {
    type: knownType,
    threadId,
    turnId: optionalTurnId(params),
    method: event.method,
    params,
  };
}

class AsyncResultQueue<T, TResult> {
  private readonly values: QueuedValue<T>[] = [];
  private readonly waiters: QueueWaiter<T, TResult>[] = [];
  private result: TResult | undefined;
  private failure: unknown;
  private completed = false;

  push(value: T): void {
    if (this.completed || this.failure !== undefined) {
      return;
    }

    const waiter = this.waiters.shift();

    if (waiter) {
      waiter.resolve({ done: false, value });
      return;
    }

    this.values.push({ value });
  }

  complete(result: TResult): void {
    if (this.completed || this.failure !== undefined) {
      return;
    }

    this.completed = true;
    this.result = result;
    this.flushCompletion();
  }

  fail(error: unknown): void {
    if (this.completed || this.failure !== undefined) {
      return;
    }

    this.failure = error;
    this.values.length = 0;

    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  next(): Promise<IteratorResult<T, TResult>> {
    const queued = this.values.shift();

    if (queued) {
      return Promise.resolve({ done: false, value: queued.value });
    }

    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }

    if (this.completed) {
      return Promise.resolve({
        done: true,
        value: this.result as TResult,
      });
    }

    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private flushCompletion(): void {
    if (this.values.length > 0) {
      return;
    }

    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({
        done: true,
        value: this.result as TResult,
      });
    }
  }
}

export class CodexTurnStream {
  private readonly queue =
    new AsyncResultQueue<CodexTurnEvent, CodexTurnResult>();
  private readonly pending: CodexRpcIncomingEvent[] = [];
  private turnId: string | undefined;
  private completed = false;

  constructor(readonly threadId: string) {}

  get activeTurnId(): string | undefined {
    return this.turnId;
  }

  get isCompleted(): boolean {
    return this.completed;
  }

  start(turn: CodexTurn): void {
    this.turnId = turn.id;
    this.queue.push({
      type: 'turn-started',
      threadId: this.threadId,
      turn,
    });

    for (const pending of this.pending.splice(0)) {
      this.acceptReadyEvent(pending);
    }
  }

  accept(rpcEvent: CodexRpcIncomingEvent): boolean {
    if (optionalThreadId(rpcEvent.params) !== this.threadId) {
      return false;
    }

    if (!this.turnId) {
      this.pending.push(rpcEvent);
      return true;
    }

    this.acceptReadyEvent(rpcEvent);
    return true;
  }

  fail(error: unknown): void {
    this.queue.fail(error);
  }

  next(): Promise<
    IteratorResult<CodexTurnEvent, CodexTurnResult>
  > {
    return this.queue.next();
  }

  private acceptReadyEvent(rpcEvent: CodexRpcIncomingEvent): void {
    const event = toTurnEvent(rpcEvent, this.threadId);

    if (!event || event.type === 'turn-started') {
      return;
    }

    const eventTurnId =
      event.type === 'turn-completed'
        ? event.turn.id
        : 'turnId' in event
          ? event.turnId
          : undefined;

    if (eventTurnId && eventTurnId !== this.turnId) {
      return;
    }

    this.queue.push(event);

    if (event.type === 'turn-completed') {
      this.completed = true;
      this.queue.complete({
        threadId: this.threadId,
        turn: event.turn,
      });
    }
  }
}
