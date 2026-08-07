export type AgentMcpServerTransport =
  | {
      readonly type: 'stdio';
      readonly command: string;
      readonly args?: readonly string[];
      readonly workingDirectory?: string;
      readonly environment?: Readonly<Record<string, string>>;
      readonly environmentVariables?: readonly string[];
    }
  | {
      readonly type: 'streamable-http';
      readonly url: string;
      readonly bearerTokenEnvironmentVariable?: string;
      readonly headers?: Readonly<Record<string, string>>;
      readonly environmentHeaders?: Readonly<Record<string, string>>;
    };

export interface AgentMcpServerDefinition {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  readonly transport: AgentMcpServerTransport;
  readonly startupTimeoutMs?: number;
  readonly toolTimeoutMs?: number;
  readonly enabledTools?: readonly string[];
  readonly disabledTools?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return value;
}

function requireText(value: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return normalized;
}

function requireEnvironmentVariableName(value: string): string {
  const normalized = value.trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(normalized)) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return normalized;
}

function cloneStringMap(
  value: Readonly<Record<string, string>> | undefined,
  valueValidator: (entry: string) => string = requireText,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const entries = Object.entries(value)
    .map(([key, entry]) => [requireText(key), valueValidator(entry)] as const)
    .sort(([left], [right]) => left.localeCompare(right));

  if (
    new Set(entries.map(([key]) => key.toLowerCase())).size !== entries.length
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return Object.freeze(Object.fromEntries(entries));
}

function cloneUniqueStrings(
  value: readonly string[] | undefined,
  validator: (entry: string) => string = requireText,
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const entries = value.map(validator);

  if (new Set(entries).size !== entries.length) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return Object.freeze([...entries].sort());
}

function cloneTransport(
  transport: AgentMcpServerTransport,
): AgentMcpServerTransport {
  if (transport.type === 'stdio') {
    const command = requireText(transport.command);
    const workingDirectory = transport.workingDirectory?.trim();

    if (workingDirectory && !isAbsolute(workingDirectory)) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    return Object.freeze({
      type: 'stdio' as const,
      command,
      ...(transport.args
        ? { args: Object.freeze(transport.args.map(requireText)) }
        : {}),
      ...(workingDirectory
        ? { workingDirectory: resolve(workingDirectory) }
        : {}),
      ...(transport.environment
        ? { environment: cloneStringMap(transport.environment) }
        : {}),
      ...(transport.environmentVariables
        ? {
            environmentVariables: cloneUniqueStrings(
              transport.environmentVariables,
              requireEnvironmentVariableName,
            ),
          }
        : {}),
    });
  }

  let url: URL;

  try {
    url = new URL(transport.url);
  } catch {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return Object.freeze({
    type: 'streamable-http' as const,
    url: url.toString(),
    ...(transport.bearerTokenEnvironmentVariable
      ? {
          bearerTokenEnvironmentVariable: requireEnvironmentVariableName(
            transport.bearerTokenEnvironmentVariable,
          ),
        }
      : {}),
    ...(transport.headers
      ? { headers: cloneStringMap(transport.headers) }
      : {}),
    ...(transport.environmentHeaders
      ? {
          environmentHeaders: cloneStringMap(
            transport.environmentHeaders,
            requireEnvironmentVariableName,
          ),
        }
      : {}),
  });
}

export function cloneAgentMcpServerDefinition(
  definition: AgentMcpServerDefinition,
): AgentMcpServerDefinition {
  const id = requireAgentCapabilityId(definition.id);
  const version = requirePositiveInteger(definition.version)!;
  const enabledTools = cloneUniqueStrings(definition.enabledTools);
  const disabledTools = cloneUniqueStrings(definition.disabledTools);

  if (
    enabledTools &&
    disabledTools &&
    enabledTools.some((tool) => disabledTools.includes(tool))
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  const startupTimeoutMs = requirePositiveInteger(
    definition.startupTimeoutMs,
  );
  const toolTimeoutMs = requirePositiveInteger(definition.toolTimeoutMs);

  return Object.freeze({
    id,
    version,
    description: requireText(definition.description),
    transport: cloneTransport(definition.transport),
    ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
    ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
    ...(enabledTools ? { enabledTools } : {}),
    ...(disabledTools ? { disabledTools } : {}),
  });
}

export function isAgentMcpServerDefinition(
  value: unknown,
): value is AgentMcpServerDefinition {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.version === 'number' &&
    typeof value.description === 'string' &&
    isRecord(value.transport) &&
    (value.transport.type === 'stdio' ||
      value.transport.type === 'streamable-http')
  );
}
import { isAbsolute, resolve } from 'node:path';

import { requireAgentCapabilityId } from '../capabilities/agent-capability-id';
import { AppError } from '../../errors/app-error';
