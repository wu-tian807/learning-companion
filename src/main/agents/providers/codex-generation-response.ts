import { isJsonValue } from '../../../shared/workbench/protocol';
import { AppError } from '../../errors/app-error';
import type { GenerationTokenUsage } from '../../generation/contracts/generation-metrics';
import type { GenerationAgentEvent } from '../../generation/generation-agent-runner';
import type {
  CodexThreadItem,
  CodexThreadSelection,
  CodexTurn,
  CodexTurnEvent,
} from '../codex/codex-runtime-types';
import { CodexRpcError } from '../codex/codex-rpc-connection';
import {
  CODEX_FUNCTION_TOOL_NAMESPACE,
  findSelectedCodexFunctionTool,
  type CodexGenerationToolSelection,
} from './codex-function-tools';

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolName(
  item: CodexThreadItem,
  mcpServerIdsByWireName: ReadonlyMap<string, string>,
): string | undefined {
  if (
    item.type === 'commandExecution' ||
    item.type === 'fileChange' ||
    item.type === 'webSearch' ||
    item.type === 'imageView'
  ) {
    return item.type;
  }

  if (item.type === 'mcpToolCall') {
    const server = typeof item.server === 'string' ? item.server : 'unknown';
    const tool = typeof item.tool === 'string' ? item.tool : 'unknown';
    return `mcp:${mcpServerIdsByWireName.get(server) ?? server}/${tool}`;
  }

  if (item.type === 'dynamicToolCall') {
    return typeof item.tool === 'string'
      ? `dynamic:${item.tool}`
      : 'dynamic:unknown';
  }

  return undefined;
}

function isToolItemAllowed(
  item: CodexThreadItem,
  tools: CodexGenerationToolSelection,
  mcpServerIdsByWireName: ReadonlyMap<string, string>,
): boolean {
  const nativeToolIds = new Set(tools.nativeToolIds);

  if (item.type === 'commandExecution') {
    return (
      nativeToolIds.has('workspace.read') ||
      nativeToolIds.has('workspace.search') ||
      nativeToolIds.has('workspace.write')
    );
  }

  if (item.type === 'dynamicToolCall') {
    return (
      typeof item.tool === 'string' &&
      findSelectedCodexFunctionTool(tools, item.tool) !== undefined &&
      item.namespace === CODEX_FUNCTION_TOOL_NAMESPACE
    );
  }

  if (item.type === 'mcpToolCall') {
    return (
      typeof item.server === 'string' &&
      typeof item.tool === 'string' &&
      mcpServerIdsByWireName.has(item.server)
    );
  }

  return (
    item.type === 'fileChange' &&
    nativeToolIds.has('workspace.write')
  );
}

function hasClientMessage(turn: CodexTurn, clientId: string): boolean {
  return (turn.items ?? []).some(
    (item) => item.type === 'userMessage' && item.clientId === clientId,
  );
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

export function requireCodexThreadSelection(
  selection: CodexThreadSelection,
  expectedThreadId?: string,
): CodexThreadSelection {
  const threadId = selection.thread.id.trim();
  const model = selection.model?.trim();

  if (
    threadId.length === 0 ||
    !model ||
    (expectedThreadId !== undefined && threadId !== expectedThreadId)
  ) {
    throw new AppError('CODEX_PROTOCOL_ERROR');
  }

  return selection;
}

export function isMissingCodexThreadError(error: unknown): boolean {
  const cause = error instanceof AppError ? error.cause : error;
  return (
    cause instanceof CodexRpcError &&
    cause.code === -32_600 &&
    cause.message.startsWith('no rollout found for thread id')
  );
}

export function toGenerationToolEvent(
  event: Extract<CodexTurnEvent, { type: 'item-started' | 'item-completed' }>,
  tools: CodexGenerationToolSelection,
  mcpServerIdsByWireName: ReadonlyMap<string, string> = new Map(),
): GenerationAgentEvent | undefined {
  const name = toolName(event.item, mcpServerIdsByWireName);

  if (!name) {
    return undefined;
  }

  if (
    !isToolItemAllowed(
      event.item,
      tools,
      mcpServerIdsByWireName,
    )
  ) {
    throw new AppError('CODEX_PROTOCOL_ERROR', {
      cause: new Error(`Codex 使用了未声明的工具：${name}`),
    });
  }

  const payload = isJsonValue(event.item) ? event.item : undefined;
  return {
    type: 'tool-call',
    phase: event.type === 'item-started' ? 'started' : 'completed',
    callId: event.item.id,
    toolName: name,
    ...(payload ? { payload } : {}),
  };
}

export function findRecoveredCodexTurn(
  selection: CodexThreadSelection,
  clientId: string,
): CodexTurn | undefined {
  return [...(selection.thread.turns ?? [])]
    .reverse()
    .find(
      (turn) => turn.status === 'completed' && hasClientMessage(turn, clientId),
    );
}

export function codexTokenUsageFromEvent(
  event: CodexTurnEvent,
): GenerationTokenUsage | undefined {
  if (event.type !== 'token-usage-updated' || !isRecord(event.params)) {
    return undefined;
  }

  const tokenUsage = event.params.tokenUsage;
  const total = isRecord(tokenUsage) ? tokenUsage.total : undefined;

  if (!isRecord(total)) {
    return undefined;
  }

  const usage = {
    inputTokens: nonNegativeInteger(total.inputTokens),
    cachedInputTokens: nonNegativeInteger(total.cachedInputTokens),
    outputTokens: nonNegativeInteger(total.outputTokens),
    reasoningTokens: nonNegativeInteger(total.reasoningOutputTokens),
    totalTokens: nonNegativeInteger(total.totalTokens),
  };
  const entries = Object.entries(usage).filter(([, value]) => value !== undefined);
  return entries.length > 0
    ? (Object.freeze(Object.fromEntries(entries)) as GenerationTokenUsage)
    : undefined;
}

export function codexModelFromReroute(
  event: CodexTurnEvent,
): string | undefined {
  if (
    event.type === 'notification' &&
    event.method === 'model/rerouted' &&
    isRecord(event.params)
  ) {
    return optionalText(
      typeof event.params.toModel === 'string'
        ? event.params.toModel
        : undefined,
    );
  }

  return undefined;
}

export function codexTurnTiming(
  turn: CodexTurn,
  fallbackStartedTime: number,
  fallbackCompletedTime: number,
) {
  const startedAt = typeof turn.startedAt === 'number' ? turn.startedAt : undefined;
  const completedAt =
    typeof turn.completedAt === 'number' ? turn.completedAt : undefined;
  const startedTime = startedAt === undefined
    ? fallbackStartedTime
    : Math.max(0, Math.round(startedAt * 1_000));
  const completedTime = completedAt === undefined
    ? Math.max(startedTime, fallbackCompletedTime)
    : Math.max(startedTime, Math.round(completedAt * 1_000));
  const durationMs =
    typeof turn.durationMs === 'number' &&
    Number.isFinite(turn.durationMs) &&
    turn.durationMs >= 0
      ? turn.durationMs
      : completedTime - startedTime;

  return { startedTime, completedTime, activeDurationMs: durationMs };
}
