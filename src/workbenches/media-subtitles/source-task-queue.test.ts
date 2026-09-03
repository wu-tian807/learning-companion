import { describe, expect, it, vi } from 'vitest';

import { MediaSubtitleSourceTaskQueue } from './source-task-queue';

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('MediaSubtitleSourceTaskQueue', () => {
  it('serializes ASR tasks submitted by separate Workbench services', async () => {
    const queue = new MediaSubtitleSourceTaskQueue();
    const firstGate = deferred();
    const calls: string[] = [];
    const first = queue.enqueue('video', async () => {
      calls.push('video:start');
      await firstGate.promise;
      calls.push('video:end');
      return 'video';
    });
    const secondTask = vi.fn(async () => {
      calls.push('audio');
      return 'audio';
    });
    const second = queue.enqueue('audio', secondTask);

    await vi.waitFor(() => expect(calls).toEqual(['video:start']));
    expect(secondTask).not.toHaveBeenCalled();

    firstGate.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual([
      'video',
      'audio',
    ]);
    expect(calls).toEqual(['video:start', 'video:end', 'audio']);
  });

  it('continues with the next ASR task after a failure', async () => {
    const queue = new MediaSubtitleSourceTaskQueue();

    await expect(
      queue.enqueue('failed', async () => {
        throw new Error('transcription failed');
      }),
    ).rejects.toThrow('transcription failed');
    await expect(
      queue.enqueue('recovered', async () => 'recovered'),
    ).resolves.toBe('recovered');
  });

  it('runs an opened asset before background work that has not started', async () => {
    const queue = new MediaSubtitleSourceTaskQueue();
    const firstGate = deferred();
    const calls: string[] = [];
    const first = queue.enqueue('running', async () => {
      calls.push('running');
      await firstGate.promise;
    });
    const background = queue.enqueue(
      'background',
      async () => {
        calls.push('background');
      },
      'background',
    );
    const interactive = queue.enqueue('interactive', async () => {
      calls.push('interactive');
    });

    await vi.waitFor(() => expect(calls).toEqual(['running']));
    firstGate.resolve();
    await Promise.all([first, background, interactive]);

    expect(calls).toEqual(['running', 'interactive', 'background']);
  });

  it('promotes a queued background task when its asset is opened', async () => {
    const queue = new MediaSubtitleSourceTaskQueue();
    const firstGate = deferred();
    const calls: string[] = [];
    const first = queue.enqueue('running', () => firstGate.promise);
    const promoted = queue.enqueue(
      'promoted',
      async () => {
        calls.push('promoted');
      },
      'background',
    );
    const background = queue.enqueue(
      'background',
      async () => {
        calls.push('background');
      },
      'background',
    );

    queue.promote('promoted');
    firstGate.resolve();
    await Promise.all([first, promoted, background]);

    expect(calls).toEqual(['promoted', 'background']);
  });
});
