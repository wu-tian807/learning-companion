import { describe, expect, it, vi } from 'vitest';

import type {
  GenerationTaskEvent,
  GenerationTaskView,
  StartGenerationTaskRequest,
} from '../../shared/generation-tasks';
import {
  GenerationTaskFailedError,
  runGenerationTask,
  type GenerationTaskTransport,
} from './run-generation-task';

const request: StartGenerationTaskRequest = {
  projectId: 'project-1',
  definitionId: 'question',
  definitionVersion: 1,
  instruction: {},
  assetReferences: {},
};

function task(
  status: GenerationTaskView['status'],
  overrides: Partial<GenerationTaskView> = {},
): GenerationTaskView {
  return {
    id: 'task-1',
    projectId: request.projectId,
    definitionId: request.definitionId,
    definitionVersion: 1,
    status,
    metrics: {},
    createdTime: 1,
    updatedTime: 1,
    ...overrides,
  };
}

function createTransport() {
  let listener: ((event: GenerationTaskEvent) => void) | undefined;
  const transport: GenerationTaskTransport = {
    start: vi.fn(async () => task('created')),
    cancel: vi.fn(async () => undefined),
    subscribe: vi.fn((next) => {
      listener = next;
      return vi.fn();
    }),
  };
  return { transport, emit: (event: GenerationTaskEvent) => listener?.(event) };
}

describe('runGenerationTask', () => {
  it('resolves the authoritative completed snapshot', async () => {
    const { transport, emit } = createTransport();
    const running = runGenerationTask(request, { transport });
    await vi.waitFor(() => expect(transport.start).toHaveBeenCalledOnce());
    const completed = task('completed', { result: { answer: 'done' } });

    emit({ type: 'task-completed', snapshot: completed });

    await expect(running).resolves.toEqual(completed);
  });

  it('does not lose a completion event published before start returns', async () => {
    const { transport, emit } = createTransport();
    let completeStart!: (value: GenerationTaskView) => void;
    vi.mocked(transport.start).mockReturnValue(
      new Promise((resolve) => {
        completeStart = resolve;
      }),
    );
    const running = runGenerationTask(request, { transport });
    const completed = task('completed', { result: { answer: 'early' } });
    emit({ type: 'task-completed', snapshot: completed });
    completeStart(task('created'));

    await expect(running).resolves.toEqual(completed);
  });

  it('rejects failed tasks with the persisted failure detail', async () => {
    const { transport, emit } = createTransport();
    const running = runGenerationTask(request, { transport });
    await vi.waitFor(() => expect(transport.start).toHaveBeenCalledOnce());
    emit({
      type: 'task-changed',
      snapshot: task('failed', {
        failure: {
          phase: 'process',
          failedTime: 2,
          message: 'failed',
          detail: 'provider unavailable',
        },
      }),
    });

    await expect(running).rejects.toMatchObject({
      name: GenerationTaskFailedError.name,
      message: 'provider unavailable',
    });
  });

  it('cancels the created task when the caller aborts during start', async () => {
    const { transport } = createTransport();
    let completeStart!: (value: GenerationTaskView) => void;
    vi.mocked(transport.start).mockReturnValue(
      new Promise((resolve) => {
        completeStart = resolve;
      }),
    );
    const controller = new AbortController();
    const running = runGenerationTask(request, {
      signal: controller.signal,
      transport,
    });
    controller.abort();
    completeStart(task('created'));

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(transport.cancel).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskId: 'task-1',
    });
  });
});
