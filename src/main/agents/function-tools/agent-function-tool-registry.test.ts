import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors/app-error';
import type { AgentFunctionToolDefinition } from './agent-function-tool';
import { AgentFunctionToolRegistry } from './agent-function-tool-registry';

function definition(
  id: string,
  overrides: Partial<AgentFunctionToolDefinition> = {},
): AgentFunctionToolDefinition {
  return {
    id,
    version: 1,
    description: `Tool ${id}`,
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      additionalProperties: false,
    },
    execute: vi.fn(async () => null),
    ...overrides,
  };
}

describe('AgentFunctionToolRegistry', () => {
  it('registers frozen definitions and returns a stable sorted list', () => {
    const registry = new AgentFunctionToolRegistry();
    const schema = {
      type: 'object',
      properties: { value: { type: 'string' } },
    } as const;

    registry.register(definition('second_tool'));
    registry.register(
      definition('first_tool', {
        description: '  First tool  ',
        inputSchema: schema,
        deferLoading: true,
      }),
    );
    (schema.properties.value as { type: string }).type = 'number';

    expect(registry.list().map(({ id }) => id)).toEqual([
      'first_tool',
      'second_tool',
    ]);
    expect(registry.get('first_tool')).toEqual(
      expect.objectContaining({
        description: 'First tool',
        deferLoading: true,
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
        },
      }),
    );
    expect(Object.isFrozen(registry.require('first_tool'))).toBe(true);
    expect(Object.isFrozen(registry.require('first_tool').inputSchema)).toBe(
      true,
    );
  });

  it.each([
    definition('Invalid.Name'),
    definition('invalid-version', { version: 0 }),
    definition('missing_description', { description: '  ' }),
    definition('invalid_schema', { inputSchema: [] }),
    definition('non_object_schema', {
      inputSchema: { type: 'string' },
    }),
    definition('invalid_defer_loading', {
      deferLoading: 'yes' as unknown as boolean,
    }),
  ])('rejects invalid definitions', (invalidDefinition) => {
    const registry = new AgentFunctionToolRegistry();

    expect(() => registry.register(invalidDefinition)).toThrowError(
      new AppError('INVALID_EXTENSION_DEFINITION'),
    );
  });

  it('rejects duplicate ids and reports missing required tools', () => {
    const registry = new AgentFunctionToolRegistry();
    registry.register(definition('read_asset_anchor'));

    expect(() =>
      registry.register(definition('read_asset_anchor', { version: 2 })),
    ).toThrowError(new AppError('REGISTRATION_CONFLICT'));
    expect(() => registry.require('missing_tool')).toThrowError(
      new AppError('FEATURE_NOT_SUPPORTED'),
    );
  });

  it('preserves the handler and passes execution input unchanged', async () => {
    const execute = vi.fn(async () => ({ ok: true } as const));
    const registry = new AgentFunctionToolRegistry();
    registry.register(definition('read_asset_anchor', { execute }));
    const context = {
      taskId: 'task-1',
      projectId: 'project-1',
      workspaces: {
        primary: {
          key: 'generation-mindmap',
          scope: 'task' as const,
          instanceKey: 'task-1',
          path: 'D:\\workspace\\task-1',
          permissions: { read: true, write: false },
        },
        secondary: [],
      },
    };

    await expect(
      registry.require('read_asset_anchor').execute(
        { assetId: 'asset-1' },
        context,
      ),
    ).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith({ assetId: 'asset-1' }, context);
  });
});
