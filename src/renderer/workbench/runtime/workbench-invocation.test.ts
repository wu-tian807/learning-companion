import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchActionBundle } from '../actions/workbench-action';
import { WorkbenchActionRegistry } from './workbench-action-registry';
import {
  createWorkbenchInvocationContext,
  WorkbenchActionInvoker,
} from './workbench-invocation';
import {
  createWorkbenchRuntimeStore,
  type WorkbenchRuntimeIdentity,
} from './workbench-runtime-store';

const identity: WorkbenchRuntimeIdentity = {
  projectId: 'project-1',
  assetId: 'asset-1',
  workbenchId: 'builtin.plain-text',
  sessionId: 'session-1',
};

function bundle(
  execute: WorkbenchActionBundle['actions'][number]['execute'],
  enabled: WorkbenchActionBundle['actions'][number]['enabled'] = true,
): WorkbenchActionBundle {
  return {
    actions: [
      {
        id: 'plain-text.copy',
        enabled,
        execute,
      },
    ],
    contributions: [],
  };
}

describe('Workbench action invocation', () => {
  it('creates an immutable interaction snapshot', () => {
    const interaction = {
      selection: {
        text: '冻结内容',
        target: {
          scope: 'content' as const,
          anchorType: 'text.range',
          anchorVersion: 1,
          anchorPayload: { start: 0, end: 4 },
        },
      },
    };
    const invocation = createWorkbenchInvocationContext(
      identity,
      'context-menu',
      interaction,
    );

    interaction.selection.text = '后来修改';

    expect(invocation.selection?.text).toBe('冻结内容');
    expect(Object.isFrozen(invocation)).toBe(true);
    expect(Object.isFrozen(invocation.selection)).toBe(true);
  });

  it('executes active actions and isolates duplicate clicks', async () => {
    let release: (() => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const registry = new WorkbenchActionRegistry();
    const store = createWorkbenchRuntimeStore();
    store.getState().activate(identity);
    registry.register('builtin.plain-text', bundle(execute));
    const invoker = new WorkbenchActionInvoker(registry, store, {
      reportError: vi.fn(),
    });
    const invocation = createWorkbenchInvocationContext(
      identity,
      'context-menu',
      {},
    );

    const first = invoker.invoke('plain-text.copy', invocation);
    await expect(
      invoker.invoke('plain-text.copy', invocation),
    ).resolves.toBe('busy');
    release?.();
    await expect(first).resolves.toBe('executed');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects stale and disabled actions without execution', async () => {
    const execute = vi.fn();
    const registry = new WorkbenchActionRegistry();
    const store = createWorkbenchRuntimeStore();
    store.getState().activate(identity);
    registry.register(
      'builtin.plain-text',
      bundle(execute, false),
    );
    const invoker = new WorkbenchActionInvoker(registry, store, {
      reportError: vi.fn(),
    });

    await expect(
      invoker.invoke(
        'plain-text.copy',
        createWorkbenchInvocationContext(
          { ...identity, sessionId: 'stale-session' },
          'context-menu',
          {},
        ),
      ),
    ).resolves.toBe('stale');
    await expect(
      invoker.invoke(
        'plain-text.copy',
        createWorkbenchInvocationContext(
          identity,
          'context-menu',
          {},
        ),
      ),
    ).resolves.toBe('disabled');
    expect(execute).not.toHaveBeenCalled();
  });

  it('re-evaluates dynamic action state when invoked', async () => {
    let enabled = false;
    const execute = vi.fn();
    const registry = new WorkbenchActionRegistry();
    const store = createWorkbenchRuntimeStore();
    store.getState().activate(identity);
    registry.register(
      'builtin.plain-text',
      bundle(execute, () => enabled),
    );
    const invoker = new WorkbenchActionInvoker(registry, store, {
      reportError: vi.fn(),
    });
    const invocation = createWorkbenchInvocationContext(
      identity,
      'context-menu',
      {},
    );

    await expect(
      invoker.invoke('plain-text.copy', invocation),
    ).resolves.toBe('disabled');
    enabled = true;
    await expect(
      invoker.invoke('plain-text.copy', invocation),
    ).resolves.toBe('executed');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reports action failures and clears busy state', async () => {
    const registry = new WorkbenchActionRegistry();
    const store = createWorkbenchRuntimeStore();
    const reportError = vi.fn();
    store.getState().activate(identity);
    registry.register(
      'builtin.plain-text',
      bundle(() => {
        throw new Error('复制失败');
      }),
    );
    const invoker = new WorkbenchActionInvoker(registry, store, {
      reportError,
    });

    await expect(
      invoker.invoke(
        'plain-text.copy',
        createWorkbenchInvocationContext(
          identity,
          'context-menu',
          {},
        ),
      ),
    ).resolves.toBe('failed');
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      '工作台操作失败，请重试。',
    );
    expect(store.getState().busyActionIds.size).toBe(0);
  });
});
