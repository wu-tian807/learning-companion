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
    const first = queue.enqueue(async () => {
      calls.push('video:start');
      await firstGate.promise;
      calls.push('video:end');
      return 'video';
    });
    const secondTask = vi.fn(async () => {
      calls.push('audio');
      return 'audio';
    });
    const second = queue.enqueue(secondTask);

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
      queue.enqueue(async () => {
        throw new Error('transcription failed');
      }),
    ).rejects.toThrow('transcription failed');
    await expect(queue.enqueue(async () => 'recovered')).resolves.toBe(
      'recovered',
    );
  });
});
