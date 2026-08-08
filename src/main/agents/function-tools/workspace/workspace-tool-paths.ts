import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { isPathInside } from '../../../filesystem/file-system-path-rules';
import type { PreparedAgentWorkspace } from '../../../generation/contracts/generation-workspace';
import {
  AgentFunctionToolExecutionError,
  type AgentFunctionToolExecutionContext,
} from '../agent-function-tool';

export interface ResolvedWorkspaceToolPath {
  readonly workspace: PreparedAgentWorkspace;
  readonly relativePath: string;
  readonly absolutePath: string;
}

export function requireWorkspaceToolObject(
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentFunctionToolExecutionError('工具参数必须是 JSON 对象。');
  }

  return value as Record<string, unknown>;
}

export function optionalWorkspaceToolString(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = input[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AgentFunctionToolExecutionError(`${key} 必须是非空字符串。`);
  }

  return value.trim();
}

export function workspaceToolInteger(
  input: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = input[key];

  if (value === undefined) {
    return fallback;
  }

  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    throw new AgentFunctionToolExecutionError(
      `${key} 必须是 ${minimum} 到 ${maximum} 之间的整数。`,
    );
  }

  return Number(value);
}

function selectWorkspace(
  context: AgentFunctionToolExecutionContext,
  workspaceKey: string | undefined,
): PreparedAgentWorkspace {
  const workspaces = [
    context.workspaces.primary,
    ...context.workspaces.secondary,
  ];
  const workspace = workspaceKey
    ? workspaces.find(({ key }) => key === workspaceKey)
    : context.workspaces.primary;

  if (!workspace) {
    throw new AgentFunctionToolExecutionError(
      `不存在 Workspace：${workspaceKey ?? '(primary)'}。`,
    );
  }

  if (!workspace.permissions.read) {
    throw new AgentFunctionToolExecutionError(
      `Workspace ${workspace.key} 不允许读取。`,
    );
  }

  return workspace;
}

function normalizeRelativePath(value: string, allowRoot: boolean): string {
  const normalized = value.trim().replaceAll('\\', '/');
  const segments = normalized.split('/');

  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    segments.some((segment) => segment === '..') ||
    segments.some((segment) => segment.length === 0) ||
    (!allowRoot && (normalized === '.' || normalized.length === 0))
  ) {
    throw new AgentFunctionToolExecutionError(
      'path 必须是 Workspace 内不含 .. 的相对路径。',
    );
  }

  if (allowRoot && normalized === '.') {
    return '.';
  }

  if (segments.some((segment) => segment === '.')) {
    throw new AgentFunctionToolExecutionError('path 中不能包含 . 路径段。');
  }

  return segments.join('/');
}

async function verifyExistingPath(
  workspacePath: string,
  candidatePath: string,
): Promise<void> {
  let resolvedRoot: string;
  let resolvedCandidate: string;

  try {
    [resolvedRoot, resolvedCandidate] = await Promise.all([
      realpath(workspacePath),
      realpath(candidatePath),
    ]);
  } catch {
    throw new AgentFunctionToolExecutionError('指定路径不存在或无法读取。');
  }

  if (!isPathInside(resolvedRoot, resolvedCandidate)) {
    throw new AgentFunctionToolExecutionError('指定路径超出了 Workspace。');
  }
}

export async function resolveReadableWorkspaceToolPath(
  context: AgentFunctionToolExecutionContext,
  input: Readonly<Record<string, unknown>>,
  options: {
    readonly allowRoot?: boolean;
    readonly defaultPath?: string;
  } = {},
): Promise<ResolvedWorkspaceToolPath> {
  context.signal?.throwIfAborted();
  const workspaceKey = optionalWorkspaceToolString(input, 'workspaceKey');
  const workspace = selectWorkspace(context, workspaceKey);
  const rawPath =
    optionalWorkspaceToolString(input, 'path') ?? options.defaultPath;

  if (rawPath === undefined) {
    throw new AgentFunctionToolExecutionError('缺少必需参数 path。');
  }

  const relativePath = normalizeRelativePath(
    rawPath,
    options.allowRoot === true,
  );
  const platformAbsolutePath =
    relativePath === '.'
      ? workspace.path
      : resolve(workspace.path, ...relativePath.split('/'));

  if (!isPathInside(workspace.path, platformAbsolutePath)) {
    throw new AgentFunctionToolExecutionError('指定路径超出了 Workspace。');
  }

  await verifyExistingPath(workspace.path, platformAbsolutePath);

  return Object.freeze({
    workspace,
    relativePath,
    absolutePath: platformAbsolutePath,
  });
}
