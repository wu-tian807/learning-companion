import type { AgentWorkspaceManagerApi } from '../../agents/workspaces/agent-workspace-manager';

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

export interface AgentSessionLocator {
  readonly projectId: string;
  readonly providerId: string;
  readonly workspaceKey: string;
  readonly instanceKey: string;
}

const workspaceKeyPattern = /^[a-z][a-z0-9-]{0,63}$/u;

function requireText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Agent workspace ${field} 不能为空`);
  }

  return normalized;
}

export function requireAgentWorkspaceKey(value: string): string {
  const normalized = requireText(value, 'key');

  if (!workspaceKeyPattern.test(normalized)) {
    throw new Error('Agent workspace key 必须是扁平 kebab-case 主键');
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

  if (config.scope === 'shared' && config.permissions.write) {
    throw new Error('Shared Agent workspace 不允许 Agent 写入');
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
): readonly [string, string] {
  const cloned = cloneAgentWorkspaceConfig(config);
  const instanceKey =
    cloned.scope === 'shared' ? 'shared' : requireText(taskId, 'taskId');

  return Object.freeze([cloned.key, instanceKey]);
}

export async function prepareAgentWorkspace(
  manager: AgentWorkspaceManagerApi,
  config: AgentWorkspaceConfig,
  taskId: string,
): Promise<PreparedAgentWorkspace> {
  const cloned = cloneAgentWorkspaceConfig(config);
  const segments = resolveAgentWorkspaceSegments(cloned, taskId);
  const path = await manager.prepare(segments);

  return Object.freeze({
    ...cloned,
    instanceKey: segments[1],
    path,
  });
}

export function createAgentSessionLocator(input: {
  readonly projectId: string;
  readonly providerId: string;
  readonly primaryWorkspace: PreparedAgentWorkspace;
}): AgentSessionLocator {
  return Object.freeze({
    projectId: requireText(input.projectId, 'projectId'),
    providerId: requireText(input.providerId, 'providerId'),
    workspaceKey: requireAgentWorkspaceKey(input.primaryWorkspace.key),
    instanceKey: requireText(
      input.primaryWorkspace.instanceKey,
      'instanceKey',
    ),
  });
}
