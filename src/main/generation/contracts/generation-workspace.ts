import type { AgentWorkspaceManagerApi } from '../../agents/workspaces/agent-workspace-manager';
import {
  requireAgentWorkspaceKey,
  requireAgentWorkspacePathSegment,
} from '../../agents/workspaces/agent-workspace-paths';

export type AgentWorkspaceScope = 'shared' | 'task' | 'named';

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

  if (
    config.scope !== 'shared' &&
    config.scope !== 'task' &&
    config.scope !== 'named'
  ) {
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
  namedInstanceKey?: string,
): readonly [string, string] {
  const cloned = cloneAgentWorkspaceConfig(config);
  const instanceKey =
    cloned.scope === 'shared'
      ? 'shared'
      : cloned.scope === 'task'
        ? requireText(taskId, 'taskId')
        : requireAgentWorkspacePathSegment(namedInstanceKey ?? '');

  if (cloned.scope !== 'named' && namedInstanceKey !== undefined) {
    throw new Error('Agent workspace named instanceKey 仅适用于 named scope');
  }

  return Object.freeze([cloned.key, instanceKey]);
}

export async function prepareAgentWorkspace(
  manager: AgentWorkspaceManagerApi,
  config: AgentWorkspaceConfig,
  taskId: string,
  namespaceSegments: readonly string[] = [],
  namedInstanceKey?: string,
): Promise<PreparedAgentWorkspace> {
  const cloned = cloneAgentWorkspaceConfig(config);
  const segments = resolveAgentWorkspaceSegments(
    cloned,
    taskId,
    namedInstanceKey,
  );
  const path = await manager.prepare([...namespaceSegments, ...segments]);

  return Object.freeze({
    ...cloned,
    instanceKey: segments[1],
    path,
  });
}
