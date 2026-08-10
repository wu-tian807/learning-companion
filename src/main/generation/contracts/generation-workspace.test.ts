import { describe, expect, it, vi } from 'vitest';

import { createAgentSessionLocator } from '../../agents/sessions/agent-session';
import {
  cloneAgentWorkspaceConfig,
  prepareAgentWorkspace,
} from './generation-workspace';

describe('generation workspace contracts', () => {
  it('maps a task-scoped primary workspace to a provider-neutral session locator', async () => {
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
        workspaceKey: workspace.key,
        instanceKey: workspace.instanceKey,
      }),
    ).toEqual({
      projectId: 'project-1',
      workspaceKey: 'generation-mindmap',
      instanceKey: 'task-1',
    });
  });

  it('uses shared as the stable instance key without overriding permissions', async () => {
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
        permissions: { read: true, write: true },
      },
      'ignored-task-id',
    );

    expect(workspace.instanceKey).toBe('shared');
    expect(workspace.permissions).toEqual({ read: true, write: true });
    expect(manager.prepare).toHaveBeenCalledWith([
      'project-outline',
      'shared',
    ]);
  });

  it('rejects nested keys and write-only workspace permissions', () => {
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
        permissions: { read: false, write: true },
      }),
    ).toThrow('permissions 数据无效');
  });
});
