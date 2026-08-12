import {
  isGenerationTaskView,
  type GenerationTaskEvent,
  type GenerationTaskView,
  type StartGenerationTaskRequest,
} from '../../shared/generation-tasks';

export interface GenerationTaskTransport {
  start(request: StartGenerationTaskRequest): Promise<GenerationTaskView>;
  cancel(request: { readonly projectId: string; readonly taskId: string }): Promise<void>;
  subscribe(listener: (event: GenerationTaskEvent) => void): () => void;
}

const defaultTransport: GenerationTaskTransport = {
  start: (request) => window.learningCompanion.startGenerationTask(request),
  cancel: (request) => window.learningCompanion.cancelGenerationTask(request),
  subscribe: (listener) =>
    window.learningCompanion.onGenerationTaskChanged(listener),
};

export class GenerationTaskFailedError extends Error {
  constructor(readonly task: GenerationTaskView) {
    super(task.failure?.detail ?? task.failure?.message ?? '生成任务没有完成。');
    this.name = 'GenerationTaskFailedError';
  }
}

function terminalSnapshot(
  event: GenerationTaskEvent,
): GenerationTaskView | undefined {
  if (event.type === 'task-completed') return event.snapshot;
  if (
    event.type === 'task-changed' &&
    (event.snapshot.status === 'failed' ||
      event.snapshot.status === 'cancelled')
  ) {
    return event.snapshot;
  }
  return undefined;
}

function abortError(): Error {
  return new DOMException('生成任务已取消。', 'AbortError');
}

export function runGenerationTask(
  request: StartGenerationTaskRequest,
  options: {
    readonly signal?: AbortSignal;
    readonly transport?: GenerationTaskTransport;
  } = {},
): Promise<GenerationTaskView> {
  const transport = options.transport ?? defaultTransport;
  const signal = options.signal;

  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const earlyTerminalSnapshots = new Map<string, GenerationTaskView>();
    let taskId: string | undefined;
    let abortRequested = false;
    let settled = false;
    let unsubscribe = () => undefined;

    const dispose = () => {
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (
      result: { readonly task: GenerationTaskView } | { readonly error: unknown },
    ) => {
      if (settled) return;
      settled = true;
      dispose();
      if ('task' in result) resolve(result.task);
      else reject(result.error);
    };
    const accept = (task: GenerationTaskView) => {
      if (task.status === 'completed') {
        finish({ task });
      } else if (task.status === 'failed' || task.status === 'cancelled') {
        finish({ error: new GenerationTaskFailedError(task) });
      }
    };
    const cancel = async () => {
      if (!taskId || settled) return;
      try {
        await transport.cancel({ projectId: request.projectId, taskId });
        finish({ error: abortError() });
      } catch (error) {
        finish({ error });
      }
    };
    const onAbort = () => {
      abortRequested = true;
      void cancel();
    };
    unsubscribe = transport.subscribe((event) => {
      const terminal = terminalSnapshot(event);
      if (
        !terminal ||
        terminal.projectId !== request.projectId ||
        terminal.definitionId !== request.definitionId
      ) {
        return;
      }
      if (taskId === terminal.id) accept(terminal);
      else if (!taskId) earlyTerminalSnapshots.set(terminal.id, terminal);
    });
    signal?.addEventListener('abort', onAbort, { once: true });

    void transport.start(request).then(
      (started) => {
        if (!isGenerationTaskView(started)) {
          finish({ error: new Error('GenerationTask 创建响应无效') });
          return;
        }
        taskId = started.id;
        const terminal = earlyTerminalSnapshots.get(taskId);
        earlyTerminalSnapshots.clear();
        if (abortRequested) {
          void cancel();
        } else {
          accept(terminal ?? started);
        }
      },
      (error) => finish({ error }),
    );
  });
}
