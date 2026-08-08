import type { JsonValue } from '../../../shared/workbench/protocol';

export interface GenerationTokenUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
}

export interface GenerationAgentExecutionMetrics {
  readonly callKey: string;
  readonly purpose: string;
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
  /** Wall-clock duration of TaskDefinition.process, including Agent calls. */
  readonly processDurationMs?: number;
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
    isRequiredText(value.callKey) &&
    isRequiredText(value.purpose) &&
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
    value.repairTurnCount <= value.turnCount &&
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
    (value.processDurationMs === undefined ||
      isNonNegativeNumber(value.processDurationMs)) &&
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

function cloneExecution(
  execution: GenerationAgentExecutionMetrics,
): GenerationAgentExecutionMetrics {
  if (!isGenerationAgentExecutionMetrics(execution)) {
    throw new Error('Generation Agent execution metrics 数据无效');
  }

  return Object.freeze({
    ...execution,
    callKey: execution.callKey.trim(),
    purpose: execution.purpose.trim(),
    sessionId: execution.sessionId.trim(),
    providerId: execution.providerId.trim(),
    modelId: execution.modelId.trim(),
    ...(execution.usage ? { usage: cloneUsage(execution.usage) } : {}),
  });
}

function activeDuration(
  prepareDurationMs: number | undefined,
  executions: readonly GenerationAgentExecutionMetrics[],
  processDurationMs: number | undefined,
): number {
  return (
    (prepareDurationMs ?? 0) +
    (processDurationMs ??
      executions.reduce(
        (total, execution) => total + execution.activeDurationMs,
        0,
      ))
  );
}

export function cloneGenerationTaskMetrics(
  metrics: GenerationTaskMetrics,
): GenerationTaskMetrics {
  if (!isGenerationTaskMetrics(metrics)) {
    throw new Error('Generation task metrics 数据无效');
  }

  const executions = Object.freeze(
    metrics.agentExecutions.map(cloneExecution),
  );
  const expectedActiveDuration = activeDuration(
    metrics.prepareDurationMs,
    executions,
    metrics.processDurationMs,
  );

  if (metrics.totalActiveDurationMs !== expectedActiveDuration) {
    throw new Error('Generation task active duration 数据不一致');
  }

  return Object.freeze({
    ...(metrics.prepareDurationMs === undefined
      ? {}
      : { prepareDurationMs: metrics.prepareDurationMs }),
    agentExecutions: executions,
    ...(metrics.processDurationMs === undefined
      ? {}
      : { processDurationMs: metrics.processDurationMs }),
    totalActiveDurationMs: expectedActiveDuration,
    ...(metrics.totalUsage
      ? { totalUsage: cloneUsage(metrics.totalUsage) }
      : {}),
  });
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
  const current = cloneGenerationTaskMetrics(metrics);
  const clonedExecution = cloneExecution(execution);

  if (
    current.processDurationMs !== undefined ||
    current.agentExecutions.some(
      ({ callKey }) => callKey === clonedExecution.callKey,
    )
  ) {
    throw new Error('Generation Agent execution 顺序或 callKey 无效');
  }

  const executions = Object.freeze([
    ...current.agentExecutions,
    clonedExecution,
  ]);
  const totalUsage = mergeGenerationTokenUsage(
    current.totalUsage,
    clonedExecution.usage,
  );

  return Object.freeze({
    ...(current.prepareDurationMs === undefined
      ? {}
      : { prepareDurationMs: current.prepareDurationMs }),
    agentExecutions: executions,
    totalActiveDurationMs: activeDuration(
      current.prepareDurationMs,
      executions,
      undefined,
    ),
    ...(totalUsage ? { totalUsage } : {}),
  });
}

export function withGenerationPhaseDuration(
  metrics: GenerationTaskMetrics,
  phase: 'prepare' | 'process',
  durationMs: number,
): GenerationTaskMetrics {
  const current = cloneGenerationTaskMetrics(metrics);

  if (!isNonNegativeNumber(durationMs)) {
    throw new Error('Generation phase metrics 数据无效');
  }

  const prepareDurationMs =
    phase === 'prepare' ? durationMs : current.prepareDurationMs;
  const processDurationMs =
    phase === 'process' ? durationMs : current.processDurationMs;

  return Object.freeze({
    ...(prepareDurationMs === undefined ? {} : { prepareDurationMs }),
    agentExecutions: Object.freeze([...current.agentExecutions]),
    ...(processDurationMs === undefined ? {} : { processDurationMs }),
    totalActiveDurationMs: activeDuration(
      prepareDurationMs,
      current.agentExecutions,
      processDurationMs,
    ),
    ...(current.totalUsage
      ? { totalUsage: cloneUsage(current.totalUsage) }
      : {}),
  });
}

export function generationTaskMetricsToJson(
  metrics: GenerationTaskMetrics,
): JsonValue {
  return JSON.parse(
    JSON.stringify(cloneGenerationTaskMetrics(metrics)),
  ) as JsonValue;
}
