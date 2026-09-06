import { expect, it } from 'vitest';
import { WorkbenchOpenCoordinator } from './workbench-open-coordinator';

it('settles only the current attempt and does not retain readiness after cancellation', async () => {
  const coordinator = new WorkbenchOpenCoordinator('project-1');
  const first = { projectId: 'project-1', assetId: 'a', attempt: Symbol() };
  const next = { projectId: 'project-1', assetId: 'a', attempt: Symbol() };
  const pending = coordinator.waitFor('a');
  coordinator.report({ ...first, status: 'opening' });
  const cancelled = expect(pending).rejects.toThrow('取消');
  coordinator.report({ ...first, status: 'cancelled' });
  await cancelled;
  const retry = coordinator.waitFor('a');
  coordinator.report({ ...next, status: 'opening' });
  coordinator.report({ ...first, status: 'ready' });
  coordinator.report({ ...first, status: 'cancelled' });
  coordinator.report({ ...next, status: 'ready' });
  await retry;
  coordinator.report({ ...next, status: 'cancelled' });
  const reopened = coordinator.waitFor('a');
  const abandoned = expect(reopened).rejects.toThrow('取消');
  coordinator.dispose();
  await abandoned;
});

it('rejects on selection change and disposal, including requests made before mounting a Host', async () => {
  const coordinator = new WorkbenchOpenCoordinator('project-1');
  const pending = coordinator.waitFor('a');
  const cancelled = expect(pending).rejects.toThrow('取消');
  coordinator.cancelExcept('b');
  await cancelled;
  const next = coordinator.waitFor('b');
  const disposed = expect(next).rejects.toThrow('取消');
  coordinator.dispose();
  coordinator.dispose();
  await disposed;
});

it('allows a failed open to be retried without the old Host cleanup cancelling the retry', async () => {
  const coordinator = new WorkbenchOpenCoordinator('project-1');
  const first = { projectId: 'project-1', assetId: 'a', attempt: Symbol() };
  const pending = coordinator.waitFor('a');
  coordinator.report({ ...first, status: 'opening' });
  const failure = expect(pending).rejects.toThrow('failed');
  coordinator.report({ ...first, status: 'failed', error: new Error('failed') });
  await failure;
  expect(coordinator.needsRetry('a')).toBe(true);
  const retry = coordinator.waitFor('a');
  coordinator.report({ ...first, status: 'cancelled' });
  const next = { projectId: 'project-1', assetId: 'a', attempt: Symbol() };
  coordinator.report({ ...next, status: 'opening' });
  coordinator.report({ ...next, status: 'ready' });
  await retry;
});
