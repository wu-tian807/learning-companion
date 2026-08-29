import type { JsonValue } from '../../../shared/workbench/protocol';
import type { AgentWorkspacePreparationApi } from '../../agents/workspaces/agent-workspace-manager';
import {
  requireAgentWorkspaceKey,
  requireAgentWorkspacePathSegment,
} from '../../agents/workspaces/agent-workspace-paths';

export interface AgentWorkspacePermissions {
  readonly read: boolean;
  readonly write: boolean;
}

export interface AgentWorkspaceConfig {
  readonly key: string;
  readonly permissions: AgentWorkspacePermissions;
  /**
   * Resolves the concrete Workspace and Provider Session partition. When
   * omitted, each GenerationTask uses its own taskId.
   */
  readonly resolveInstanceKey?: (
    context: AgentWorkspaceInstanceContext,
  ) => string;
}

export interface AgentWorkspaceInstanceContext {
  readonly taskId: string;
  readonly instruction: JsonValue;
}

export interface PreparedAgentWorkspace {
  readonly key: string;
  readonly permissions: AgentWorkspacePermissions;
  readonly instanceKey: string;
  readonly path: string;
}

export interface PreparedAgentWorkspaces {
  readonly primary: PreparedAgentWorkspace;
  readonly secondary: readonly PreparedAgentWorkspace[];
}

export function cloneAgentWorkspaceConfig(
  config: AgentWorkspaceConfig,
): AgentWorkspaceConfig {
  const key = requireAgentWorkspaceKey(config.key);

  if (
    config.resolveInstanceKey !== undefined &&
    typeof config.resolveInstanceKey !== 'function'
  ) {
    throw new Error('Agent workspace resolveInstanceKey 数据无效');
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
    permissions: Object.freeze({ ...config.permissions }),
    ...(config.resolveInstanceKey
      ? { resolveInstanceKey: config.resolveInstanceKey }
      : {}),
  });
}

function resolveInstanceKey(
  config: AgentWorkspaceConfig,
  context: AgentWorkspaceInstanceContext,
): string {
  const normalizedContext = Object.freeze({
    taskId: requireAgentWorkspacePathSegment(context.taskId),
    instruction: context.instruction,
  });
  const resolved = config.resolveInstanceKey
    ? config.resolveInstanceKey(normalizedContext)
    : normalizedContext.taskId;

  return requireAgentWorkspacePathSegment(
    resolved,
  );
}

export async function prepareAgentWorkspace(
  manager: AgentWorkspacePreparationApi,
  config: AgentWorkspaceConfig,
  context: AgentWorkspaceInstanceContext,
  namespaceSegments: readonly string[] = [],
): Promise<PreparedAgentWorkspace> {
  const cloned = cloneAgentWorkspaceConfig(config);
  const instanceKey = resolveInstanceKey(cloned, context);
  const path = await manager.prepare([
    ...namespaceSegments,
    cloned.key,
    instanceKey,
  ]);

  return Object.freeze({
    key: cloned.key,
    permissions: cloned.permissions,
    instanceKey,
    path,
  });
}
