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
import {
  WORKSPACE_READ_TOOL_ID,
  WORKSPACE_SEARCH_TOOL_ID,
  WORKSPACE_VIEW_IMAGE_TOOL_ID,
  WORKSPACE_WRITE_TOOL_ID,
} from '../function-tools/builtin-agent-function-tool-ids';
import type { CodexGenerationEnvironment } from './codex-generation-environment';
import {
  type CodexGenerationCapabilitySelection,
} from './codex-generation-capabilities';
import {
  isCodexWorkspaceGenerationTool,
  type CodexGenerationToolSelection,
} from './codex-function-tools';

export const CODEX_AGENT_PROVIDER_ID = 'codex';
export const CODEX_ACCOUNT_MODEL_PROVIDER_ID = 'openai';

export type CodexGenerationConnection =
  | { readonly kind: 'account' }
  | {
      readonly kind: 'api-key';
      readonly baseUrl: string;
      readonly modelProviderId: string;
      readonly environmentKey: string;
    };

const CODEX_GENERATION_EXECUTION_POLICY = [
  'Learning Companion generation execution boundary:',
  '- Use only the workspace roots and Skill resources supplied for this task and obey their filesystem permissions.',
  '- Do not request broader filesystem or network access.',
  '- Use only the Skills and MCP servers explicitly supplied by Learning Companion for this task; do not discover or invoke ambient capabilities.',
  '- Do not use apps/connectors, plugins, hooks, memories, goals, or subagents.',
  '- Use the shell for file discovery and ordinary text inspection inside the supplied workspace roots.',
  '- Use apply_patch only when a writable workspace is supplied, and modify files only inside writable workspace roots.',
  '- For PDFs, start with workspace_read_pdf extract_text on manageable page ranges to locate relevant sections and page numbers. It reads embedded text only and is not OCR; sparse, empty, or garbled text is not evidence that the page is blank.',
  '- Then use workspace_read_pdf render_pages on every relevant page and whenever formulas, tables, figures, layout, or missing text matter. The default scale 1.5 suits normal pages; raise it toward 2 only for small text or formulas. Do not form the final answer from extracted text alone. Use view_image for standalone image files.',
  '- Treat the writable workspace as the task output surface. Read-only source workspaces must never be modified.',
  '- Keep the final assistant message brief; it reports completed work and is not itself the generated artifact.',
].join('\n');

export interface CodexGenerationConfiguration {
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

function tomlDottedKeySegment(value: string): string {
  return /^[A-Za-z0-9_-]+$/u.test(value) ? value : JSON.stringify(value);
}

function disabledMcpServerOverrideKey(name: string): string {
  return `mcp_servers.${tomlDottedKeySegment(name)}.enabled`;
}

function collectReadableWorkspaces(request: GenerationAgentTurnRequest) {
  return [request.workspaces.primary, ...request.workspaces.secondary]
    .filter((workspace) => workspace.permissions.read)
    .sort((left, right) => left.path.localeCompare(right.path));
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
    callKey: request.callKey,
  }).slice(0, 40)}`;
}

export function toCodexUserInput(
  request: GenerationAgentTurnRequest,
  capabilities: CodexGenerationCapabilitySelection,
): readonly CodexTurnUserInput[] {
  const messageInput = request.userMessage.content.map((part) => {
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

  if (capabilities.skills.length === 0) {
    return messageInput;
  }

  return Object.freeze([
    {
      type: 'text' as const,
      text: capabilities.skills.map(({ id }) => `$${id}`).join(' '),
    },
    ...capabilities.skills.map(({ id, path }) => ({
      type: 'skill' as const,
      name: id,
      path,
    })),
    ...messageInput,
  ]);
}

export function createCodexGenerationConfiguration(
  request: GenerationAgentTurnRequest,
  environment: CodexGenerationEnvironment,
  tools: CodexGenerationToolSelection,
  capabilities: CodexGenerationCapabilitySelection,
  connection: CodexGenerationConnection = { kind: 'account' },
): CodexGenerationConfiguration {
  const readableWorkspaces = collectReadableWorkspaces(request);
  const workspaceToolEnabled = tools.effectiveRequirements.some(({ id }) =>
    isCodexWorkspaceGenerationTool(id),
  );
  const workspaceWriteEnabled = tools.nativeToolIds.includes(
    WORKSPACE_WRITE_TOOL_ID,
  );
  const shellEnabled = tools.nativeToolIds.some(
    (id) =>
      id === WORKSPACE_READ_TOOL_ID ||
      id === WORKSPACE_SEARCH_TOOL_ID ||
      id === WORKSPACE_WRITE_TOOL_ID,
  );
  const viewImageEnabled = tools.nativeToolIds.includes(
    WORKSPACE_VIEW_IMAGE_TOOL_ID,
  );

  if (
    (workspaceToolEnabled && readableWorkspaces.length === 0) ||
    (workspaceWriteEnabled &&
      !readableWorkspaces.some(({ permissions }) => permissions.write))
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  if (connection.kind === 'api-key' && !request.modelId) {
    throw new AppError('DATA_INTEGRITY_ERROR', {
      cause: new Error('自定义 Codex API 必须指定模型 ID'),
    });
  }

  const runtimeWorkspaceRoots = readableWorkspaces.map(({ path }) => path);
  const filesystem: Readonly<Record<string, 'read' | 'write'>> =
    Object.freeze({
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
      ...Object.fromEntries(
        capabilities.skills.map(({ directoryPath }) => [
          directoryPath,
          'read',
        ]),
      ),
    });
  const permissionProfile: JsonValue = {
    filesystem,
    network: { enabled: false },
  };
  const profileId = `lc-generation-${hashJson(permissionProfile).slice(0, 24)}`;
  const selectedMcpServerNames = new Set(
    capabilities.mcpServers.map(({ wireName }) => wireName),
  );
  const disabledMcpServerOverrides = Object.fromEntries(
    environment.disabledMcpServers
      .filter((name) => !selectedMcpServerNames.has(name))
      .map(
        (name) => [disabledMcpServerOverrideKey(name), false] as const,
      ),
  );
  const selectedMcpServers = Object.fromEntries(
    capabilities.mcpServers.map(({ wireName, config }) => [
      wireName,
      config,
    ] as const),
  );
  const selectedSkillPaths = new Set(
    capabilities.skills.map(({ path }) => path),
  );
  const disabledSkillPaths = environment.disabledSkillPaths.filter(
    (path) => !selectedSkillPaths.has(path),
  );
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
      shell_tool: shellEnabled,
    },
    tools: { view_image: viewImageEnabled },
    web_search: 'disabled',
    ...(connection.kind === 'api-key'
      ? {
          model_providers: {
            [connection.modelProviderId]: {
              name: 'Learning Companion Custom API',
              base_url: connection.baseUrl,
              env_key: connection.environmentKey,
              requires_openai_auth: false,
              wire_api: 'responses',
            },
          },
        }
      : {}),
    permissions: {
      [profileId]: permissionProfile,
    },
    ...disabledMcpServerOverrides,
    ...(Object.keys(selectedMcpServers).length > 0
      ? { mcp_servers: selectedMcpServers }
      : {}),
    ...(disabledSkillPaths.length > 0
      ? {
          skills: {
            config: disabledSkillPaths.map((path) => ({
              path,
              enabled: false,
            })),
          },
        }
      : {}),
  };
  const common = {
    ...(request.modelId ? { model: request.modelId } : {}),
    modelProvider:
      connection.kind === 'api-key'
        ? connection.modelProviderId
        : CODEX_ACCOUNT_MODEL_PROVIDER_ID,
    cwd: request.workspaces.primary.path,
    runtimeWorkspaceRoots,
    approvalPolicy: 'never' as const,
    permissions: profileId,
    configOverrides,
    developerInstructions: `${request.systemInstruction}\n\n${CODEX_GENERATION_EXECUTION_POLICY}`,
  };

  return Object.freeze({
    profileId,
    runtimeWorkspaceRoots: Object.freeze(runtimeWorkspaceRoots),
    threadInput: Object.freeze({
      ...common,
      ...(tools.dynamicTools.length > 0
        ? { dynamicTools: tools.dynamicTools }
        : {}),
    }),
    resumeInput: Object.freeze({ ...common, excludeTurns: false }),
  });
}
