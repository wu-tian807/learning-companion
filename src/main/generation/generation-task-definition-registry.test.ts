import { describe, expect, it } from 'vitest';

import { createMindMapGenerationTaskDefinition } from '../../workbenches/mindmap/generation/mindmap-generation-task-definition';
import { GenerationTaskDefinitionRegistry } from './generation-task-definition-registry';

function createDefinition() {
  return createMindMapGenerationTaskDefinition({
    async process() {
      return { resultAssetId: 'asset-1' };
    },
  });
}

describe('GenerationTaskDefinitionRegistry', () => {
  it('indexes definitions by stable id and version', () => {
    const registry = new GenerationTaskDefinitionRegistry();
    const definition = createDefinition();

    registry.register(definition);

    expect(registry.require(definition.id, definition.version)).toBe(
      definition,
    );
    expect(registry.get(definition.id, definition.version + 1)).toBeUndefined();
  });

  it('rejects duplicate registration', () => {
    const registry = new GenerationTaskDefinitionRegistry();
    registry.register(createDefinition());

    expect(() => registry.register(createDefinition())).toThrow(
      'REGISTRATION_CONFLICT',
    );
  });

  it('keeps Agent turn configuration inside process calls', () => {
    const definition = createDefinition();

    expect(definition).not.toHaveProperty('systemInstruction');
    expect(definition).not.toHaveProperty('toolRequirements');
    expect(definition).not.toHaveProperty('skills');
    expect(definition).not.toHaveProperty('mcpServers');
    expect(definition.primaryWorkspaceConfig.permissions).toEqual({
      read: true,
      write: true,
    });
  });
});
