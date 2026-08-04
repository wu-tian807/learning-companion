import type { JsonValue } from '../../../shared/workbench/protocol';

export interface GenerationTokenUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
}

export interface GenerationAgentExecutionMetrics {
  readonly sessionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly startedTime: number;
  readonly completedTime: number;
  readonly activeDurationMs: number;
  readonly turnCount: number;
  readonly repairTurnCount: number;
  readonly usage?: GenerationTokenUsage;
}

export interface GenerationTaskMetrics {
  readonly prepareDurationMs?: number;
  readonly agentExecutions: readonly GenerationAgentExecutionMetrics[];
  readonly postProcessDurationMs?: number;
  readonly totalActiveDurationMs: number;
  readonly totalUsage?: GenerationTokenUsage;
}

const usageFields = [
  'inputTokens',
  'cachedInputTokens',
  'outputTokens',
  'reasoningTokens',
  'totalTokens',
] as const satisfies readonly (keyof GenerationTokenUsage)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isOptionalTokenCount(value: unknown): value is number | undefined {
  return value === undefined || isNonNegativeInteger(value);
}

export function isGenerationTokenUsage(
  value: unknown,
): value is GenerationTokenUsage {
  return (
    isRecord(value) &&
    usageFields.every((field) => isOptionalTokenCount(value[field])) &&
    usageFields.some((field) => value[field] !== undefined)
  );
}

export function isGenerationAgentExecutionMetrics(
  value: unknown,
): value is GenerationAgentExecutionMetrics {
  return (
    isRecord(value) &&
    isRequiredText(value.sessionId) &&
    isRequiredText(value.providerId) &&
    isRequiredText(value.modelId) &&
    isNonNegativeInteger(value.startedTime) &&
    isNonNegativeInteger(value.completedTime) &&
    value.completedTime >= value.startedTime &&
    isNonNegativeNumber(value.activeDurationMs) &&
    isNonNegativeInteger(value.turnCount) &&
    value.turnCount > 0 &&
    isNonNegativeInteger(value.repairTurnCount) &&
    value.repairTurnCount < value.turnCount &&
    (value.usage === undefined || isGenerationTokenUsage(value.usage))
  );
}

export function isGenerationTaskMetrics(
  value: unknown,
): value is GenerationTaskMetrics {
  return (
    isRecord(value) &&
    (value.prepareDurationMs === undefined ||
      isNonNegativeNumber(value.prepareDurationMs)) &&
    Array.isArray(value.agentExecutions) &&
    value.agentExecutions.every(isGenerationAgentExecutionMetrics) &&
    (value.postProcessDurationMs === undefined ||
      isNonNegativeNumber(value.postProcessDurationMs)) &&
    isNonNegativeNumber(value.totalActiveDurationMs) &&
    (value.totalUsage === undefined ||
      isGenerationTokenUsage(value.totalUsage))
  );
}

export function emptyGenerationTaskMetrics(): GenerationTaskMetrics {
  return Object.freeze({
    agentExecutions: Object.freeze([]),
    totalActiveDurationMs: 0,
  });
}

export function cloneGenerationTaskMetrics(
  metrics: GenerationTaskMetrics,
): GenerationTaskMetrics {
  if (!isGenerationTaskMetrics(metrics)) {
    throw new Error('Generation task metrics 数据无效');
  }

  return Object.freeze({
    ...(metrics.prepareDurationMs === undefined
      ? {}
      : { prepareDurationMs: metrics.prepareDurationMs }),
    agentExecutions: Object.freeze(
      metrics.agentExecutions.map((execution) =>
        Object.freeze({
          ...execution,
          sessionId: execution.sessionId.trim(),
          providerId: execution.providerId.trim(),
          modelId: execution.modelId.trim(),
          ...(execution.usage
            ? { usage: cloneUsage(execution.usage) }
            : {}),
        }),
      ),
    ),
    ...(metrics.postProcessDurationMs === undefined
      ? {}
      : { postProcessDurationMs: metrics.postProcessDurationMs }),
    totalActiveDurationMs: metrics.totalActiveDurationMs,
    ...(metrics.totalUsage
      ? { totalUsage: cloneUsage(metrics.totalUsage) }
      : {}),
  });
}

function cloneUsage(usage: GenerationTokenUsage): GenerationTokenUsage {
  if (!isGenerationTokenUsage(usage)) {
    throw new Error('Generation token usage 数据无效');
  }

  return Object.freeze(
    Object.fromEntries(
      usageFields.flatMap((field) =>
        usage[field] === undefined ? [] : [[field, usage[field]]],
      ),
    ) as GenerationTokenUsage,
  );
}

export function mergeGenerationTokenUsage(
  left: GenerationTokenUsage | undefined,
  right: GenerationTokenUsage | undefined,
): GenerationTokenUsage | undefined {
  if (!left && !right) {
    return undefined;
  }

  const result = Object.fromEntries(
    usageFields.flatMap((field) => {
      const leftValue = left?.[field];
      const rightValue = right?.[field];

      return leftValue === undefined && rightValue === undefined
        ? []
        : [[field, (leftValue ?? 0) + (rightValue ?? 0)]];
    }),
  ) as GenerationTokenUsage;

  return cloneUsage(result);
}

export function appendGenerationAgentExecution(
  metrics: GenerationTaskMetrics,
  execution: GenerationAgentExecutionMetrics,
): GenerationTaskMetrics {
  if (
    !isGenerationTaskMetrics(metrics) ||
    !isGenerationAgentExecutionMetrics(execution)
  ) {
    throw new Error('Generation metrics 数据无效');
  }

  const clonedExecution = Object.freeze({
    ...execution,
    sessionId: execution.sessionId.trim(),
    providerId: execution.providerId.trim(),
    modelId: execution.modelId.trim(),
    ...(execution.usage ? { usage: cloneUsage(execution.usage) } : {}),
  });
  const totalUsage = mergeGenerationTokenUsage(
    metrics.totalUsage,
    execution.usage,
  );

  return Object.freeze({
    ...(metrics.prepareDurationMs === undefined
      ? {}
      : { prepareDurationMs: metrics.prepareDurationMs }),
    agentExecutions: Object.freeze([
      ...metrics.agentExecutions,
      clonedExecution,
    ]),
    ...(metrics.postProcessDurationMs === undefined
      ? {}
      : { postProcessDurationMs: metrics.postProcessDurationMs }),
    totalActiveDurationMs:
      metrics.totalActiveDurationMs + execution.activeDurationMs,
    ...(totalUsage ? { totalUsage } : {}),
  });
}

export function withGenerationPhaseDuration(
  metrics: GenerationTaskMetrics,
  phase: 'prepare' | 'post-process',
  durationMs: number,
): GenerationTaskMetrics {
  if (!isGenerationTaskMetrics(metrics) || !isNonNegativeNumber(durationMs)) {
    throw new Error('Generation phase metrics 数据无效');
  }

  const previousDuration =
    phase === 'prepare'
      ? metrics.prepareDurationMs
      : metrics.postProcessDurationMs;

  return Object.freeze({
    ...(phase === 'prepare'
      ? { prepareDurationMs: durationMs }
      : metrics.prepareDurationMs === undefined
        ? {}
        : { prepareDurationMs: metrics.prepareDurationMs }),
    agentExecutions: Object.freeze([...metrics.agentExecutions]),
    ...(phase === 'post-process'
      ? { postProcessDurationMs: durationMs }
      : metrics.postProcessDurationMs === undefined
        ? {}
        : { postProcessDurationMs: metrics.postProcessDurationMs }),
    totalActiveDurationMs:
      metrics.totalActiveDurationMs - (previousDuration ?? 0) + durationMs,
    ...(metrics.totalUsage ? { totalUsage: cloneUsage(metrics.totalUsage) } : {}),
  });
}

export function generationTaskMetricsToJson(
  metrics: GenerationTaskMetrics,
): JsonValue {
  if (!isGenerationTaskMetrics(metrics)) {
    throw new Error('Generation task metrics 数据无效');
  }

  return JSON.parse(JSON.stringify(cloneGenerationTaskMetrics(metrics))) as JsonValue;
}
