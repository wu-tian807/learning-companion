import {
  isAgentProviderConnectionId,
  isAgentProviderId,
  isAgentProviderSelectorDefinitionSnapshot,
  type AgentProviderSelectorSelectionSnapshot,
  type AgentProviderSelectorDefinitionSnapshot,
} from '../../shared/agent-providers';
import { AppError } from '../errors/app-error';

export type AgentProviderSelectorDefaultSelection = Omit<
  AgentProviderSelectorSelectionSnapshot,
  'selectorId'
>;

export interface AgentProviderSelectorDefinition
  extends AgentProviderSelectorDefinitionSnapshot {
  /** Main-only default. It is resolved, not persisted as a user choice. */
  readonly defaultSelection?: AgentProviderSelectorDefaultSelection;
}

function cloneDefinition(
  definition: AgentProviderSelectorDefinition,
): AgentProviderSelectorDefinition {
  const snapshot = {
    id: definition.id,
    displayName: definition.displayName,
    description: definition.description,
  };
  const fallback = definition.defaultSelection;
  if (
    !isAgentProviderSelectorDefinitionSnapshot(snapshot) ||
    (fallback !== undefined &&
      (!isAgentProviderId(fallback.providerId) ||
        !isAgentProviderConnectionId(fallback.connectionId) ||
        (fallback.modelId !== null &&
          (typeof fallback.modelId !== 'string' ||
            fallback.modelId.trim().length === 0)) ||
        (fallback.reasoningEffort !== null &&
          (typeof fallback.reasoningEffort !== 'string' ||
            fallback.reasoningEffort.trim().length === 0))))
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return Object.freeze({
    id: snapshot.id,
    displayName: snapshot.displayName.trim(),
    description: snapshot.description.trim(),
    ...(fallback
      ? {
          defaultSelection: Object.freeze({
            providerId: fallback.providerId,
            connectionId: fallback.connectionId,
            modelId: fallback.modelId,
            reasoningEffort: fallback.reasoningEffort,
          }),
        }
      : {}),
  });
}

/**
 * Main-process source of truth for stable business configuration slots.
 * Renderer pages receive these definitions through the setup snapshot and do
 * not maintain another list of selector identities.
 */
export class AgentProviderSelectorRegistry {
  private readonly selectors = new Map<
    string,
    AgentProviderSelectorDefinition
  >();

  register(definition: AgentProviderSelectorDefinition): void {
    const normalized = cloneDefinition(definition);

    if (this.selectors.has(normalized.id)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.selectors.set(normalized.id, normalized);
  }

  require(selectorId: string): AgentProviderSelectorDefinition {
    const selector = this.selectors.get(selectorId);

    if (!selector) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    return selector;
  }

  list(): readonly AgentProviderSelectorDefinition[] {
    return [...this.selectors.values()];
  }
}
