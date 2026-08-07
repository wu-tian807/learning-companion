import { describe, expect, it } from 'vitest';

import { createMindMapGenerationTaskDefinitionV1 } from '../../workbenches/mindmap/generation/mindmap-generation-task-definition';
import { GenerationTaskDefinitionRegistry } from './generation-task-definition-registry';

function createDefinition() {
  return createMindMapGenerationTaskDefinitionV1({
    async commit() {
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

  it('validates Skill and MCP requirement identifiers and duplicates', () => {
    const registry = new GenerationTaskDefinitionRegistry();
    const definition = createDefinition();

    expect(() =>
      registry.register({
        ...definition,
        skills: [
          { id: 'pdf-reading', availability: 'required' },
          { id: 'pdf-reading', availability: 'optional' },
        ],
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
    expect(() =>
      registry.register({
        ...definition,
        mcpServers: [
          { id: '../external-server', availability: 'required' },
        ],
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
  });

  it('validates additional tool identifiers, availability and duplicates', () => {
    const registry = new GenerationTaskDefinitionRegistry();
    const definition = createDefinition();

    expect(() =>
      registry.register({
        ...definition,
        toolRequirements: [
          { id: 'read_asset_anchor', availability: 'required' },
          { id: 'read_asset_anchor', availability: 'optional' },
        ],
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
    expect(() =>
      registry.register({
        ...definition,
        toolRequirements: [
          { id: '   ', availability: 'required' },
        ],
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
  });

  it('keeps the Mind Map definition free of Provider default tools', () => {
    expect(createDefinition().toolRequirements).toEqual([]);
  });
});
