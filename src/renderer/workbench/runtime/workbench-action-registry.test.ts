import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchActionBundle } from '../actions/workbench-action-bundle';
import { WorkbenchActionRegistry } from './workbench-action-registry';

function createBundle(
  actionId: string,
  surface: 'overflow' | 'context-menu' = 'overflow',
  order = 0,
): WorkbenchActionBundle {
  return {
    actions: [
      {
        id: actionId,
        enabled: true,
        execute: vi.fn(),
      },
    ],
    contributions: [
      {
        id: `${actionId}.${surface}`,
        actionId,
        surface,
        group: 'view',
        order,
        presentation: {
          kind: 'action',
          label: actionId,
        },
      },
    ],
  };
}

describe('WorkbenchActionRegistry', () => {
  it('registers, filters and disposes owner contributions', () => {
    const registry = new WorkbenchActionRegistry();
    const dispose = registry.register(
      'builtin.plain-text',
      createBundle('plain-text.toggle-wrap'),
    );

    expect(registry.getAction('plain-text.toggle-wrap')).toBeDefined();
    expect(registry.getContributions('overflow')).toHaveLength(1);
    expect(registry.getContributions('context-menu')).toHaveLength(0);

    dispose();
    expect(registry.getAction('plain-text.toggle-wrap')).toBeUndefined();
    expect(registry.getContributions('overflow')).toHaveLength(0);
  });

  it('atomically replaces a bundle owned by the same workbench', () => {
    const registry = new WorkbenchActionRegistry();
    const first = createBundle('plain-text.toggle-wrap');
    const second = createBundle('plain-text.toggle-lines');
    const disposeFirst = registry.register('builtin.plain-text', first);

    registry.register('builtin.plain-text', second);
    disposeFirst();

    expect(registry.getAction('plain-text.toggle-wrap')).toBeUndefined();
    expect(registry.getAction('plain-text.toggle-lines')).toBeDefined();
  });

  it('rejects duplicate action IDs across owners', () => {
    const registry = new WorkbenchActionRegistry();
    registry.register(
      'builtin.plain-text',
      createBundle('editor.copy'),
    );

    expect(() =>
      registry.register(
        'builtin.markdown',
        createBundle('editor.copy'),
      ),
    ).toThrow('Workbench Action 重复注册');
  });

  it('rejects contributions that reference absent actions', () => {
    const registry = new WorkbenchActionRegistry();

    expect(() =>
      registry.register('builtin.plain-text', {
        actions: [],
        contributions: [
          {
            id: 'plain-text.missing.overflow',
            actionId: 'plain-text.missing',
            surface: 'overflow',
            group: 'view',
            order: 0,
            presentation: {
              kind: 'action',
              label: '不存在',
            },
          },
        ],
      }),
    ).toThrow('引用了未注册 Action');
  });

  it('returns contributions in stable group and order sequence', () => {
    const registry = new WorkbenchActionRegistry();
    registry.register(
      'builtin.plain-text',
      createBundle('plain-text.second', 'overflow', 20),
    );
    registry.register(
      'builtin.markdown',
      createBundle('markdown.first', 'overflow', 10),
    );

    expect(
      registry
        .getContributions('overflow')
        .map(({ action }) => action.id),
    ).toEqual(['markdown.first', 'plain-text.second']);
  });
});
