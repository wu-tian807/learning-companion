import { createHash } from 'node:crypto';

import type { JsonValue } from '../../../shared/workbench/protocol';
import { AppError } from '../../errors/app-error';
import type { GenerationAgentTurnRequest } from '../../generation/generation-agent-runner';
import type {
  CodexJsonObject,
  CodexTurnUserInput,
  CreateCodexThreadInput,
  SelectCodexThreadInput,
} from '../codex/codex-runtime-types';
import type { AgentSessionLocator } from '../sessions/agent-session';
import type { CodexGenerationEnvironment } from './codex-generation-environment';

export const CODEX_AGENT_PROVIDER_ID = 'codex';

const SUPPORTED_GENERATION_TOOLS = new Set([
  'workspace.read',
  'workspace.search',
  'workspace.write',
]);

const CODEX_GENERATION_ADAPTER_VERSION = 2;

const CODEX_GENERATION_EXECUTION_POLICY = [
  'Learning Companion generation execution boundary:',
  '- Use only the workspace roots supplied for this task and obey their filesystem permissions.',
  '- Do not request broader filesystem or network access.',
  '- Do not use MCP servers, apps/connectors, plugins, skills, hooks, memories, goals, or subagents.',
  '- Return only an answer that conforms to the requested output schema.',
].join('\n');

export interface CodexGenerationConfiguration {
  readonly fingerprint: string;
  readonly profileId: string;
  readonly runtimeWorkspaceRoots: readonly string[];
  readonly threadInput: CreateCodexThreadInput;
  readonly resumeInput: Omit<SelectCodexThreadInput, 'threadId'>;
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  const record = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    )
    .join(',')}}`;
}

function hashJson(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function requireSupportedCodexGenerationTools(
  request: GenerationAgentTurnRequest,
): void {
  for (const tool of request.allowedTools) {
    if (
      tool.availability === 'required' &&
      !SUPPORTED_GENERATION_TOOLS.has(tool.id)
    ) {
      throw new AppError('FEATURE_NOT_SUPPORTED', {
        cause: new Error(`Codex 不支持必需工具：${tool.id}`),
      });
    }
  }
}

function collectReadableWorkspaces(request: GenerationAgentTurnRequest) {
  return [request.workspaces.primary, ...request.workspaces.secondary]
    .filter((workspace) => workspace.permissions.read)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function hasAllowedTool(
  request: GenerationAgentTurnRequest,
  toolId: string,
): boolean {
  return request.allowedTools.some(({ id }) => id === toolId);
}

function hasRequiredWorkspaceTool(
  request: GenerationAgentTurnRequest,
): boolean {
  return request.allowedTools.some(
    ({ id, availability }) =>
      availability === 'required' && SUPPORTED_GENERATION_TOOLS.has(id),
  );
}

export function codexGenerationSessionOperationKey(
  locator: AgentSessionLocator,
): string {
  return JSON.stringify([
    locator.projectId,
    locator.workspaceKey,
    locator.instanceKey,
  ]);
}

export function createCodexClientUserMessageId(
  request: GenerationAgentTurnRequest,
): string {
  return `lc-generation-${hashJson({
    taskId: request.taskId,
    userMessage: request.userMessage as unknown as JsonValue,
    outputSchema: request.outputSchema,
  }).slice(0, 40)}`;
}

export function toCodexUserInput(
  request: GenerationAgentTurnRequest,
): readonly CodexTurnUserInput[] {
  return request.userMessage.content.map((part) => {
    if (part.type === 'text') {
      return { type: 'text' as const, text: part.text };
    }

    if (part.type === 'local-image') {
      return {
        type: 'localImage' as const,
        path: part.path,
        ...(part.detail ? { detail: part.detail } : {}),
      };
    }

    return { type: 'localAudio' as const, path: part.path };
  });
}

export function createCodexGenerationConfiguration(
  request: GenerationAgentTurnRequest,
  environment: CodexGenerationEnvironment,
): CodexGenerationConfiguration {
  requireSupportedCodexGenerationTools(request);
  const readableWorkspaces = collectReadableWorkspaces(request);
  const workspaceToolEnabled = request.allowedTools.some(({ id }) =>
    SUPPORTED_GENERATION_TOOLS.has(id),
  );
  const workspaceWriteEnabled = hasAllowedTool(request, 'workspace.write');

  if (hasRequiredWorkspaceTool(request) && readableWorkspaces.length === 0) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  const descriptor: JsonValue = {
    adapterVersion: CODEX_GENERATION_ADAPTER_VERSION,
    providerId: CODEX_AGENT_PROVIDER_ID,
    systemInstruction: request.systemInstruction,
    allowedTools: request.allowedTools.map(({ id, availability }) => ({
      id,
      availability,
    })),
    workspaces: readableWorkspaces.map((workspace) => ({
      key: workspace.key,
      instanceKey: workspace.instanceKey,
      path: workspace.path,
      read: workspace.permissions.read,
      write: workspace.permissions.write && workspaceWriteEnabled,
    })),
  };
  const fingerprint = hashJson(descriptor);
  const profileId = `lc-generation-${fingerprint.slice(0, 24)}`;
  const runtimeWorkspaceRoots = readableWorkspaces.map(({ path }) => path);
  const filesystem: CodexJsonObject = {
    ':minimal': 'read',
    ...Object.fromEntries(
      workspaceToolEnabled
        ? readableWorkspaces.map((workspace) => [
            workspace.path,
            workspace.permissions.write && workspaceWriteEnabled
              ? 'write'
              : 'read',
          ])
        : [],
    ),
  };
  const configOverrides: CodexJsonObject = {
    agents: { enabled: false },
    allow_login_shell: false,
    apps: { _default: { enabled: false } },
    features: {
      apps: false,
      goals: false,
      hooks: false,
      memories: false,
      multi_agent: false,
      remote_plugin: false,
      shell_tool: workspaceToolEnabled,
    },
    tools: { view_image: false },
    web_search: 'disabled',
    permissions: {
      [profileId]: {
        filesystem,
        network: { enabled: false },
      },
    },
    ...(environment.disabledMcpServers.length > 0
      ? {
          mcp_servers: Object.fromEntries(
            environment.disabledMcpServers.map((name) => [
              name,
              { enabled: false },
            ]),
          ),
        }
      : {}),
    ...(environment.disabledSkillPaths.length > 0
      ? {
          skills: {
            config: environment.disabledSkillPaths.map((path) => ({
              path,
              enabled: false,
            })),
          },
        }
      : {}),
  };
  const common = {
    cwd: request.workspaces.primary.path,
    runtimeWorkspaceRoots,
    approvalPolicy: 'never' as const,
    permissions: profileId,
    configOverrides,
    developerInstructions: `${request.systemInstruction}\n\n${CODEX_GENERATION_EXECUTION_POLICY}`,
  };

  return Object.freeze({
    fingerprint,
    profileId,
    runtimeWorkspaceRoots: Object.freeze(runtimeWorkspaceRoots),
    threadInput: Object.freeze({ ...common }),
    resumeInput: Object.freeze({ ...common, excludeTurns: false }),
  });
}
