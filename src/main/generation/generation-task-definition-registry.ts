import type { JsonValue } from '../../shared/workbench/protocol';
import { AppError } from '../errors/app-error';
import type { GenerationInstruction } from './contracts/generation-instruction';
import type { TaskDefinition } from './contracts/task-definition';
import {
  cloneAgentWorkspaceConfig,
  type AgentWorkspaceConfig,
} from './contracts/generation-workspace';
import { cloneGenerationAssetReferenceSchema } from './contracts/generation-asset-reference';
import { requireAgentCapabilityId } from '../agents/capabilities/agent-capability-id';

type StoredTaskDefinition = TaskDefinition<
  GenerationInstruction,
  JsonValue
>;

function definitionKey(id: string, version: number): string {
  return JSON.stringify([id, version]);
}

function requireDefinitionId(value: string): string {
  const normalized = value.trim();

  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(normalized)) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return normalized;
}

function cloneWorkspaceList(
  workspaces: readonly AgentWorkspaceConfig[],
): readonly AgentWorkspaceConfig[] {
  const cloned = workspaces.map(cloneAgentWorkspaceConfig);
  const keys = cloned.map(({ key }) => key);

  if (new Set(keys).size !== keys.length) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return Object.freeze(cloned);
}

function validateDefinition(
  definition: TaskDefinition,
): void {
  requireDefinitionId(definition.id);

  if (
    !Number.isSafeInteger(definition.version) ||
    definition.version <= 0 ||
    definition.systemInstruction.trim().length === 0 ||
    typeof definition.instruction?.parse !== 'function' ||
    typeof definition.process !== 'function'
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  const primary = cloneAgentWorkspaceConfig(
    definition.primaryWorkspaceConfig,
  );
  const secondary = cloneWorkspaceList(
    definition.secondaryWorkspaceConfigs,
  );

  if (secondary.some(({ key }) => key === primary.key)) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  cloneGenerationAssetReferenceSchema(definition.assetReferenceSchema);

  const toolIds = definition.toolRequirements.map(({ id, availability }) => {
    const normalizedId = id.trim();

    if (
      normalizedId.length === 0 ||
      (availability !== 'required' && availability !== 'optional')
    ) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    return normalizedId;
  });

  if (new Set(toolIds).size !== toolIds.length) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  validateCapabilityRequirements(definition.skills);
  validateCapabilityRequirements(definition.mcpServers);
}

function validateCapabilityRequirements(
  requirements: readonly {
    readonly id: string;
    readonly availability: 'required' | 'optional';
  }[],
): void {
  const ids = requirements.map(({ id, availability }) => {
    if (availability !== 'required' && availability !== 'optional') {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    return requireAgentCapabilityId(id);
  });

  if (new Set(ids).size !== ids.length) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }
}

export class GenerationTaskDefinitionRegistry {
  private readonly definitions = new Map<string, StoredTaskDefinition>();

  register<
    TInstruction extends GenerationInstruction,
    TResult extends JsonValue,
  >(
    definition: TaskDefinition<TInstruction, TResult>,
  ): void {
    validateDefinition(definition);
    const id = requireDefinitionId(definition.id);
    const key = definitionKey(id, definition.version);

    if (this.definitions.has(key)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.definitions.set(
      key,
      definition as unknown as StoredTaskDefinition,
    );
  }

  get(
    definitionId: string,
    definitionVersion: number,
  ): StoredTaskDefinition | undefined {
    return this.definitions.get(
      definitionKey(
        requireDefinitionId(definitionId),
        definitionVersion,
      ),
    );
  }

  require(
    definitionId: string,
    definitionVersion: number,
  ): StoredTaskDefinition {
    const definition = this.get(definitionId, definitionVersion);

    if (!definition) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    return definition;
  }
}
