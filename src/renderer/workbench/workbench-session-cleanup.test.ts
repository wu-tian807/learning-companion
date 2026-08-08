import { describe, expect, it, vi } from 'vitest';

import { closeWorkbenchSession } from './workbench-session-cleanup';

describe('closeWorkbenchSession', () => {
  it('starts closing before waiting for an in-flight command', async () => {
    let releaseCommand!: () => void;
    const commandTail = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const close = vi.fn(async () => {
      releaseCommand();
    });

    await closeWorkbenchSession(close, commandTail);

    expect(close).toHaveBeenCalledOnce();
  });

  it('propagates close failures after draining commands', async () => {
    const failure = new Error('close failed');

    await expect(
      closeWorkbenchSession(
        async () => Promise.reject(failure),
        Promise.resolve(),
      ),
    ).rejects.toBe(failure);
  });
});
