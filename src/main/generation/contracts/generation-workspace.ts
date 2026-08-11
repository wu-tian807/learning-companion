import type { AgentWorkspaceManagerApi } from '../../agents/workspaces/agent-workspace-manager';
import { requireAgentWorkspaceKey } from '../../agents/workspaces/agent-workspace-paths';
import { requireAgentWorkspacePathSegment } from '../../agents/workspaces/agent-workspace-paths';

export type AgentWorkspaceScope = 'shared' | 'task';

export interface AgentWorkspacePermissions {
  readonly read: boolean;
  readonly write: boolean;
}

export interface AgentWorkspaceConfig {
  readonly key: string;
  readonly scope: AgentWorkspaceScope;
  readonly permissions: AgentWorkspacePermissions;
}

export interface PreparedAgentWorkspace extends AgentWorkspaceConfig {
  readonly instanceKey: string;
  readonly path: string;
}

export interface PreparedAgentWorkspaces {
  readonly primary: PreparedAgentWorkspace;
  readonly secondary: readonly PreparedAgentWorkspace[];
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Agent workspace ${field} 不能为空`);
  }

  return normalized;
}

export function cloneAgentWorkspaceConfig(
  config: AgentWorkspaceConfig,
): AgentWorkspaceConfig {
  const key = requireAgentWorkspaceKey(config.key);

  if (config.scope !== 'shared' && config.scope !== 'task') {
    throw new Error('Agent workspace scope 数据无效');
  }

  if (
    typeof config.permissions?.read !== 'boolean' ||
    typeof config.permissions.write !== 'boolean' ||
    (!config.permissions.read && config.permissions.write)
  ) {
    throw new Error('Agent workspace permissions 数据无效');
  }

  return Object.freeze({
    key,
    scope: config.scope,
    permissions: Object.freeze({ ...config.permissions }),
  });
}

export function resolveAgentWorkspaceSegments(
  config: AgentWorkspaceConfig,
  taskId: string,
  sharedInstanceKey?: string,
): readonly [string, string] {
  const cloned = cloneAgentWorkspaceConfig(config);
  const instanceKey =
    cloned.scope === 'shared'
      ? requireAgentWorkspacePathSegment(sharedInstanceKey ?? 'shared')
      : requireText(taskId, 'taskId');

  return Object.freeze([cloned.key, instanceKey]);
}

export async function prepareAgentWorkspace(
  manager: AgentWorkspaceManagerApi,
  config: AgentWorkspaceConfig,
  taskId: string,
  namespaceSegments: readonly string[] = [],
  sharedInstanceKey?: string,
): Promise<PreparedAgentWorkspace> {
  const cloned = cloneAgentWorkspaceConfig(config);
  const segments = resolveAgentWorkspaceSegments(cloned, taskId, sharedInstanceKey);
  const path = await manager.prepare([...namespaceSegments, ...segments]);

  return Object.freeze({
    ...cloned,
    instanceKey: segments[1],
    path,
  });
}
