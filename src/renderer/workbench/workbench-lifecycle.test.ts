import { describe, expect, it, vi } from 'vitest';

import { WorkbenchLifecycleCoordinator } from './workbench-lifecycle';

describe('WorkbenchLifecycleCoordinator', () => {
  it('keeps a replacement lifecycle behind the previous teardown', async () => {
    const coordinator = new WorkbenchLifecycleCoordinator();
    const first = coordinator.acquire();
    const second = coordinator.acquire();
    const secondReady = vi.fn();

    void second.previous.then(secondReady);
    second.release();
    await Promise.resolve();
    expect(secondReady).not.toHaveBeenCalled();

    first.release();
    await second.previous;
    expect(secondReady).toHaveBeenCalledOnce();
    await coordinator.whenIdle();
  });

  it('makes release idempotent', async () => {
    const coordinator = new WorkbenchLifecycleCoordinator();
    const lease = coordinator.acquire();

    lease.release();
    lease.release();

    await expect(lease.completed).resolves.toBeUndefined();
  });
});
