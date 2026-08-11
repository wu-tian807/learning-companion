import { describe, expect, it, vi } from 'vitest';

import { createAgentSessionLocator } from '../../agents/sessions/agent-session';
import {
  cloneAgentWorkspaceConfig,
  prepareAgentWorkspace,
} from './generation-workspace';

function createManager() {
  return {
    resolve: vi.fn(),
    prepare: vi.fn(async (segments: readonly string[]) =>
      ['workspace-root', ...segments].join('/'),
    ),
  };
}

describe('generation workspace contracts', () => {
  it('uses taskId as the default workspace and session instance key', async () => {
    const manager = createManager();
    const workspace = await prepareAgentWorkspace(
      manager,
      {
        key: 'generation-mindmap',
        permissions: { read: true, write: false },
      },
      { taskId: 'task-1', instruction: null },
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

  it('reuses a named workspace and session across tasks without conflating conversations', async () => {
    const manager = createManager();
    const config = {
      key: 'document-question',
      permissions: { read: true, write: true },
      resolveInstanceKey: ({ instruction }: { instruction: unknown }) =>
        (instruction as { conversationId: string }).conversationId,
    };
    const first = await prepareAgentWorkspace(manager, config, {
      taskId: 'task-1',
      instruction: { conversationId: 'conversation-a' },
    });
    const continued = await prepareAgentWorkspace(manager, config, {
      taskId: 'task-2',
      instruction: { conversationId: 'conversation-a' },
    });
    const isolated = await prepareAgentWorkspace(manager, config, {
      taskId: 'task-3',
      instruction: { conversationId: 'conversation-b' },
    });

    expect(first.instanceKey).toBe('conversation-a');
    expect(continued.path).toBe(first.path);
    expect(isolated.instanceKey).toBe('conversation-b');
    expect(isolated.path).not.toBe(first.path);
    expect(first.permissions).toEqual({ read: true, write: true });
    expect(first).not.toHaveProperty('resolveInstanceKey');
    expect(
      createAgentSessionLocator({
        projectId: 'project-1',
        workspaceKey: continued.key,
        instanceKey: continued.instanceKey,
      }),
    ).toEqual({
      projectId: 'project-1',
      workspaceKey: 'document-question',
      instanceKey: 'conversation-a',
    });
  });

  it('supports an explicitly named singleton instance without changing permissions', async () => {
    const manager = createManager();
    const workspace = await prepareAgentWorkspace(
      manager,
      {
        key: 'project-outline',
        permissions: { read: true, write: true },
        resolveInstanceKey: () => 'shared',
      },
      { taskId: 'ignored-task-id', instruction: null },
    );

    expect(workspace.instanceKey).toBe('shared');
    expect(workspace.permissions).toEqual({ read: true, write: true });
    expect(manager.prepare).toHaveBeenCalledWith([
      'project-outline',
      'shared',
    ]);
  });

  it('rejects invalid definitions, task IDs, and resolved instance keys', async () => {
    const manager = createManager();

    expect(() =>
      cloneAgentWorkspaceConfig({
        key: 'parent.child',
        permissions: { read: true, write: false },
      }),
    ).toThrow('扁平');
    expect(() =>
      cloneAgentWorkspaceConfig({
        key: 'project-outline',
        permissions: { read: false, write: true },
      }),
    ).toThrow('permissions 数据无效');
    expect(() =>
      cloneAgentWorkspaceConfig({
        key: 'project-outline',
        permissions: { read: true, write: false },
        resolveInstanceKey: 'shared' as never,
      }),
    ).toThrow('resolveInstanceKey 数据无效');
    await expect(
      prepareAgentWorkspace(
        manager,
        {
          key: 'project-outline',
          permissions: { read: true, write: false },
          resolveInstanceKey: () => '../outside',
        },
        { taskId: 'task-1', instruction: null },
      ),
    ).rejects.toThrow();
    await expect(
      prepareAgentWorkspace(
        manager,
        {
          key: 'project-outline',
          permissions: { read: true, write: false },
          resolveInstanceKey: () => undefined as never,
        },
        { taskId: 'task-1', instruction: null },
      ),
    ).rejects.toThrow();
    await expect(
      prepareAgentWorkspace(
        manager,
        {
          key: 'project-outline',
          permissions: { read: true, write: false },
        },
        { taskId: '', instruction: null },
      ),
    ).rejects.toThrow();
  });
});
