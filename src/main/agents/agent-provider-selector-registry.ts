import {
  isAgentProviderSelectorDefinitionSnapshot,
  type AgentProviderSelectorDefinitionSnapshot,
} from '../../shared/agent-providers';
import { AppError } from '../errors/app-error';

function cloneDefinition(
  definition: AgentProviderSelectorDefinitionSnapshot,
): AgentProviderSelectorDefinitionSnapshot {
  if (!isAgentProviderSelectorDefinitionSnapshot(definition)) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return Object.freeze({
    id: definition.id,
    displayName: definition.displayName.trim(),
    description: definition.description.trim(),
    ...(definition.defaultSelection
      ? {
          defaultSelection: Object.freeze({
            providerId: definition.defaultSelection.providerId,
            connectionId: definition.defaultSelection.connectionId,
            modelId: definition.defaultSelection.modelId,
            reasoningEffort: definition.defaultSelection.reasoningEffort,
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
    AgentProviderSelectorDefinitionSnapshot
  >();

  register(definition: AgentProviderSelectorDefinitionSnapshot): void {
    const normalized = cloneDefinition(definition);

    if (this.selectors.has(normalized.id)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.selectors.set(normalized.id, normalized);
  }

  require(selectorId: string): AgentProviderSelectorDefinitionSnapshot {
    const selector = this.selectors.get(selectorId);

    if (!selector) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    return selector;
  }

  list(): readonly AgentProviderSelectorDefinitionSnapshot[] {
    return Object.freeze([...this.selectors.values()]);
  }
}
