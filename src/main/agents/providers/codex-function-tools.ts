import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../../shared/workbench/protocol';
import { AppError } from '../../errors/app-error';
import type { AgentToolRequirement } from '../../generation/contracts/task-definition';
import type { GenerationAgentTurnRequest } from '../../generation/generation-agent-runner';
import type { AgentFunctionToolDefinition } from '../function-tools/agent-function-tool';
import type { AgentFunctionToolRegistryApi } from '../function-tools/agent-function-tool-registry';
import type { CodexRuntimeServiceApi } from '../codex/codex-runtime-service-api';
import type {
  CodexDynamicTool,
  CodexTurnEvent,
} from '../codex/codex-runtime-types';

export const CODEX_FUNCTION_TOOL_NAMESPACE = 'learning_companion';

const CODEX_WORKSPACE_GENERATION_TOOL_IDS = new Set([
  'workspace.read',
  'workspace.search',
  'workspace.write',
]);
const CODEX_NATIVE_GENERATION_TOOL_IDS = new Set([
  ...CODEX_WORKSPACE_GENERATION_TOOL_IDS,
]);

export interface CodexGenerationToolSelection {
  readonly effectiveRequirements: readonly AgentToolRequirement[];
  readonly nativeToolIds: readonly string[];
  readonly functionTools: readonly AgentFunctionToolDefinition[];
  readonly dynamicTools: readonly CodexDynamicTool[];
}

type CodexGenerationToolRequest = Pick<
  GenerationAgentTurnRequest,
  'toolRequirements' | 'workspaces'
>;

interface CodexFunctionToolDispatchInput {
  readonly event: Extract<CodexTurnEvent, { type: 'server-request' }>;
  readonly expectedThreadId: string;
  readonly activeTurnId?: string;
  readonly selection: CodexGenerationToolSelection;
  readonly generationRequest: Pick<
    GenerationAgentTurnRequest,
    'taskId' | 'projectId' | 'workspaces' | 'signal'
  >;
  readonly respond: CodexRuntimeServiceApi['respondToServerRequest'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isCodexNativeGenerationTool(toolId: string): boolean {
  return CODEX_NATIVE_GENERATION_TOOL_IDS.has(toolId);
}

export function isCodexWorkspaceGenerationTool(toolId: string): boolean {
  return CODEX_WORKSPACE_GENERATION_TOOL_IDS.has(toolId);
}

function allWorkspaces(request: CodexGenerationToolRequest) {
  return [request.workspaces.primary, ...request.workspaces.secondary];
}

function workspaceDefaultToolRequirements(
  request: CodexGenerationToolRequest,
): readonly AgentToolRequirement[] {
  const workspaces = allWorkspaces(request);
  const requirements: AgentToolRequirement[] = [];

  if (workspaces.some(({ permissions }) => permissions.read)) {
    requirements.push(
      { id: 'workspace.read', availability: 'required' },
      { id: 'workspace.search', availability: 'required' },
    );
  }

  if (workspaces.some(({ permissions }) => permissions.write)) {
    requirements.push({
      id: 'workspace.write',
      availability: 'required',
    });
  }

  return requirements;
}

function isWorkspaceNativeToolAuthorized(
  toolId: string,
  request: CodexGenerationToolRequest,
): boolean {
  const workspaces = allWorkspaces(request);

  if (toolId === 'workspace.write') {
    return workspaces.some(({ permissions }) => permissions.write);
  }

  if (toolId === 'workspace.read' || toolId === 'workspace.search') {
    return workspaces.some(({ permissions }) => permissions.read);
  }

  return true;
}

function mergeToolRequirements(
  ...groups: readonly (readonly AgentToolRequirement[])[]
): readonly AgentToolRequirement[] {
  const merged = new Map<string, AgentToolRequirement['availability']>();

  for (const group of groups) {
    for (const requirement of group) {
      const current = merged.get(requirement.id);
      merged.set(
        requirement.id,
        current === 'required' || requirement.availability === 'required'
          ? 'required'
          : 'optional',
      );
    }
  }

  return Object.freeze(
    [...merged.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, availability]) => Object.freeze({ id, availability })),
  );
}

function toDynamicTools(
  definitions: readonly AgentFunctionToolDefinition[],
): readonly CodexDynamicTool[] {
  if (definitions.length === 0) {
    return Object.freeze([]);
  }

  return Object.freeze([
    Object.freeze({
      type: 'namespace' as const,
      name: CODEX_FUNCTION_TOOL_NAMESPACE,
      description: 'Application tools provided by Learning Companion.',
      tools: Object.freeze(
        definitions.map((definition) =>
          Object.freeze({
            type: 'function' as const,
            name: definition.id,
            description: definition.description,
            inputSchema: definition.inputSchema,
            ...(definition.deferLoading === undefined
              ? {}
              : { deferLoading: definition.deferLoading }),
          }),
        ),
      ),
    }),
  ]);
}

export function resolveCodexGenerationTools(
  request: CodexGenerationToolRequest,
  registry: AgentFunctionToolRegistryApi,
  providerDefaultTools: readonly AgentToolRequirement[] = [],
): CodexGenerationToolSelection {
  const nativeToolIds = new Set<string>();
  const functionTools = new Map<string, AgentFunctionToolDefinition>();
  const effectiveRequirements: AgentToolRequirement[] = [];
  const requirements = mergeToolRequirements(
    workspaceDefaultToolRequirements(request),
    providerDefaultTools,
    request.toolRequirements,
  );

  for (const tool of requirements) {
    if (isCodexNativeGenerationTool(tool.id)) {
      if (!isWorkspaceNativeToolAuthorized(tool.id, request)) {
        if (tool.availability === 'required') {
          throw new AppError('DATA_INTEGRITY_ERROR', {
            cause: new Error(
              `Workspace 权限无法满足必需工具：${tool.id}`,
            ),
          });
        }
        continue;
      }

      nativeToolIds.add(tool.id);
      effectiveRequirements.push(tool);
      continue;
    }

    const definition = registry.get(tool.id);

    if (definition) {
      functionTools.set(definition.id, definition);
      effectiveRequirements.push(tool);
      continue;
    }

    if (tool.availability === 'required') {
      throw new AppError('FEATURE_NOT_SUPPORTED', {
        cause: new Error(`Codex 不支持必需工具：${tool.id}`),
      });
    }
  }

  const resolvedNativeToolIds = Object.freeze(
    [...nativeToolIds].sort((left, right) => left.localeCompare(right)),
  );
  const resolvedFunctionTools = Object.freeze(
    [...functionTools.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  );

  return Object.freeze({
    effectiveRequirements: Object.freeze(effectiveRequirements),
    nativeToolIds: resolvedNativeToolIds,
    functionTools: resolvedFunctionTools,
    dynamicTools: toDynamicTools(resolvedFunctionTools),
  });
}

export function findSelectedCodexFunctionTool(
  selection: CodexGenerationToolSelection,
  toolId: string,
): AgentFunctionToolDefinition | undefined {
  return selection.functionTools.find(({ id }) => id === toolId);
}

function failureText(toolId: string): string {
  return `Learning Companion tool "${toolId}" failed.`;
}

function resultText(result: JsonValue): string {
  return typeof result === 'string' ? result : JSON.stringify(result);
}

async function rejectProtocolRequest(
  input: CodexFunctionToolDispatchInput,
  reason: string,
): Promise<never> {
  await input.respond(input.event.request.requestId, {
    error: { code: -32_602, message: reason },
  });
  throw new AppError('CODEX_PROTOCOL_ERROR', {
    cause: new Error(reason),
  });
}

export async function handleCodexGenerationServerRequest(
  input: CodexFunctionToolDispatchInput,
): Promise<void> {
  if (input.event.request.method !== 'item/tool/call') {
    await input.respond(input.event.request.requestId, {
      error: {
        code: -32_601,
        message: 'Generation task does not allow interactive requests',
      },
    });
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  const params = input.event.request.params;

  if (!isRecord(params)) {
    return rejectProtocolRequest(input, 'Dynamic tool call params are invalid');
  }

  const threadId = typeof params.threadId === 'string' ? params.threadId : '';
  const turnId = typeof params.turnId === 'string' ? params.turnId : '';
  const callId = typeof params.callId === 'string' ? params.callId : '';
  const namespace =
    typeof params.namespace === 'string' ? params.namespace : '';
  const toolId = typeof params.tool === 'string' ? params.tool : '';
  const argumentsValue = params.arguments;

  if (
    threadId !== input.expectedThreadId ||
    input.event.threadId !== input.expectedThreadId ||
    !input.activeTurnId ||
    turnId !== input.activeTurnId ||
    input.event.turnId !== input.activeTurnId ||
    callId.trim().length === 0 ||
    namespace !== CODEX_FUNCTION_TOOL_NAMESPACE ||
    toolId.trim().length === 0 ||
    !isJsonValue(argumentsValue)
  ) {
    return rejectProtocolRequest(input, 'Dynamic tool call context is invalid');
  }

  const definition = findSelectedCodexFunctionTool(input.selection, toolId);

  if (!definition) {
    return rejectProtocolRequest(input, 'Dynamic tool is not allowed');
  }

  let result: JsonValue;

  try {
    input.generationRequest.signal?.throwIfAborted();
    const executionResult = await definition.execute(
      cloneJsonValue(argumentsValue),
      {
        taskId: input.generationRequest.taskId,
        projectId: input.generationRequest.projectId,
        workspaces: input.generationRequest.workspaces,
        ...(input.generationRequest.signal
          ? { signal: input.generationRequest.signal }
          : {}),
      },
    );
    input.generationRequest.signal?.throwIfAborted();

    if (!isJsonValue(executionResult)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    result = executionResult;
  } catch {
    input.generationRequest.signal?.throwIfAborted();
    await input.respond(input.event.request.requestId, {
      result: {
        contentItems: [
          { type: 'inputText', text: failureText(definition.id) },
        ],
        success: false,
      },
    });
    return;
  }

  await input.respond(input.event.request.requestId, {
    result: {
      contentItems: [
        { type: 'inputText', text: resultText(result) },
      ],
      success: true,
    },
  });
}
