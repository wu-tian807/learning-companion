import {
  isJsonValue,
  type JsonValue,
} from '../../../shared/workbench/protocol';
import { AppError } from '../../errors/app-error';
import type { GenerationTokenUsage } from '../../generation/contracts/generation-metrics';
import type { AllowedToolConfig } from '../../generation/contracts/task-definition';
import type { GenerationAgentEvent } from '../../generation/generation-agent-runner';
import type {
  CodexThreadItem,
  CodexThreadSelection,
  CodexTurn,
  CodexTurnEvent,
} from '../codex/codex-runtime-types';
import { CodexRpcError } from '../codex/codex-rpc-connection';

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolName(item: CodexThreadItem): string | undefined {
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
    return `mcp:${server}/${tool}`;
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
  allowedTools: readonly AllowedToolConfig[],
): boolean {
  const toolIds = new Set(allowedTools.map(({ id }) => id));

  if (item.type === 'commandExecution') {
    return (
      toolIds.has('workspace.read') ||
      toolIds.has('workspace.search') ||
      toolIds.has('workspace.write')
    );
  }

  return item.type === 'fileChange' && toolIds.has('workspace.write');
}

function findAgentMessage(turn: CodexTurn): string | undefined {
  const messages = (turn.items ?? []).filter(
    (item) => item.type === 'agentMessage' && typeof item.text === 'string',
  );
  const preferred = [...messages]
    .reverse()
    .find((item) => item.phase === 'final_answer');
  return optionalText((preferred ?? messages.at(-1))?.text as string | undefined);
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
  allowedTools: readonly AllowedToolConfig[],
): GenerationAgentEvent | undefined {
  const name = toolName(event.item);

  if (!name) {
    return undefined;
  }

  if (!isToolItemAllowed(event.item, allowedTools)) {
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

export function parseCodexAgentOutput(turn: CodexTurn): JsonValue {
  const text = findAgentMessage(turn);

  if (!text) {
    throw new AppError('CODEX_PROTOCOL_ERROR');
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonValue(parsed) ? parsed : text;
  } catch {
    return text;
  }
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
  const last = isRecord(tokenUsage) ? tokenUsage.last : undefined;

  if (!isRecord(last)) {
    return undefined;
  }

  const usage = {
    inputTokens: nonNegativeInteger(last.inputTokens),
    cachedInputTokens: nonNegativeInteger(last.cachedInputTokens),
    outputTokens: nonNegativeInteger(last.outputTokens),
    reasoningTokens: nonNegativeInteger(last.reasoningOutputTokens),
    totalTokens: nonNegativeInteger(last.totalTokens),
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
