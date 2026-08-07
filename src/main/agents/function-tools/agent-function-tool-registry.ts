import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../../shared/workbench/protocol';
import { AppError } from '../../errors/app-error';
import type { AgentFunctionToolDefinition } from './agent-function-tool';

const AGENT_FUNCTION_TOOL_ID = /^[a-z][a-z0-9_]*$/u;

export interface AgentFunctionToolRegistryApi {
  register(definition: AgentFunctionToolDefinition): void;
  get(id: string): AgentFunctionToolDefinition | undefined;
  require(id: string): AgentFunctionToolDefinition;
  list(): readonly AgentFunctionToolDefinition[];
}

function isObjectSchema(value: unknown): value is JsonValue {
  return (
    isJsonValue(value) &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Readonly<Record<string, JsonValue>>).type === 'object'
  );
}

function normalizeDefinition(
  definition: AgentFunctionToolDefinition,
): AgentFunctionToolDefinition {
  if (
    !AGENT_FUNCTION_TOOL_ID.test(definition.id) ||
    !Number.isSafeInteger(definition.version) ||
    definition.version <= 0 ||
    definition.description.trim().length === 0 ||
    !isObjectSchema(definition.inputSchema) ||
    (definition.deferLoading !== undefined &&
      typeof definition.deferLoading !== 'boolean') ||
    typeof definition.execute !== 'function'
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return Object.freeze({
    id: definition.id,
    version: definition.version,
    description: definition.description.trim(),
    inputSchema: cloneJsonValue(definition.inputSchema),
    ...(definition.deferLoading === undefined
      ? {}
      : { deferLoading: definition.deferLoading }),
    execute: definition.execute,
  });
}

export class AgentFunctionToolRegistry
  implements AgentFunctionToolRegistryApi
{
  private readonly definitions = new Map<
    string,
    AgentFunctionToolDefinition
  >();

  register(definition: AgentFunctionToolDefinition): void {
    const normalized = normalizeDefinition(definition);

    if (this.definitions.has(normalized.id)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.definitions.set(normalized.id, normalized);
  }

  get(id: string): AgentFunctionToolDefinition | undefined {
    return this.definitions.get(id);
  }

  require(id: string): AgentFunctionToolDefinition {
    const definition = this.get(id);

    if (!definition) {
      throw new AppError('FEATURE_NOT_SUPPORTED', {
        cause: new Error(`未注册 Agent Function Tool：${id}`),
      });
    }

    return definition;
  }

  list(): readonly AgentFunctionToolDefinition[] {
    return Object.freeze(
      [...this.definitions.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    );
  }
}
