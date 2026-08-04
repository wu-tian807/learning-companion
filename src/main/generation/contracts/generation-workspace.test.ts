import { describe, expect, it, vi } from 'vitest';

import {
  cloneAgentWorkspaceConfig,
  createAgentSessionLocator,
  prepareAgentWorkspace,
} from './generation-workspace';

describe('generation workspace contracts', () => {
  it('maps a task-scoped primary workspace to a provider session locator', async () => {
    const manager = {
      resolve: vi.fn(),
      prepare: vi.fn(async (segments: readonly string[]) =>
        ['workspace-root', ...segments].join('/'),
      ),
    };
    const workspace = await prepareAgentWorkspace(
      manager,
      {
        key: 'generation-mindmap',
        scope: 'task',
        permissions: { read: true, write: false },
      },
      'task-1',
    );

    expect(manager.prepare).toHaveBeenCalledWith([
      'generation-mindmap',
      'task-1',
    ]);
    expect(
      createAgentSessionLocator({
        projectId: 'project-1',
        providerId: 'codex',
        primaryWorkspace: workspace,
      }),
    ).toEqual({
      projectId: 'project-1',
      providerId: 'codex',
      workspaceKey: 'generation-mindmap',
      instanceKey: 'task-1',
    });
  });

  it('uses shared as the stable instance key', async () => {
    const manager = {
      resolve: vi.fn(),
      prepare: vi.fn(async (segments: readonly string[]) =>
        segments.join('/'),
      ),
    };
    const workspace = await prepareAgentWorkspace(
      manager,
      {
        key: 'project-outline',
        scope: 'shared',
        permissions: { read: true, write: false },
      },
      'ignored-task-id',
    );

    expect(workspace.instanceKey).toBe('shared');
  });

  it('rejects nested keys and Agent-writable shared workspaces', () => {
    expect(() =>
      cloneAgentWorkspaceConfig({
        key: 'parent.child',
        scope: 'task',
        permissions: { read: true, write: false },
      }),
    ).toThrow('扁平');
    expect(() =>
      cloneAgentWorkspaceConfig({
        key: 'project-outline',
        scope: 'shared',
        permissions: { read: true, write: true },
      }),
    ).toThrow('不允许 Agent 写入');
  });
});
