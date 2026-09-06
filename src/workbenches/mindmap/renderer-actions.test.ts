import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchInvocationContext } from '../../shared/workbench/interaction';
import { createMindMapNodeTarget } from './shared';
import { createMindMapRendererActions } from './renderer-actions';

function invocation(): WorkbenchInvocationContext {
  return {
    projectId: 'project',
    assetId: 'mindmap',
    workbenchId: 'builtin.mindmap',
    sessionId: 'session',
    origin: 'context-menu',
    focus: createMindMapNodeTarget('node-1'),
    inputs: [],
  };
}

function actions(overrides: Partial<Parameters<typeof createMindMapRendererActions>[0]> = {}) {
  return createMindMapRendererActions({
    canToggleFocusedNode: () => false,
    canAskNode: () => true,
    hasCollapsedNodes: () => false,
    onFit: vi.fn(),
    onToggleNode: vi.fn(),
    onExpandAll: vi.fn(),
    onReveal: vi.fn(),
    onAskNode: vi.fn(),
    canRevealNodeSource: () => true,
    onRevealNodeSource: vi.fn(async () => undefined),
    ...overrides,
  });
}

describe('Mind Map renderer actions', () => {
  it('routes a node context-menu question to the selected node', () => {
    const onAskNode = vi.fn();
    const bundle = actions({ onAskNode });
    const action = bundle.actions.find(({ id }) => id === 'mindmap.ai.ask-node');

    expect(action).toBeDefined();
    action!.execute(invocation());
    expect(onAskNode).toHaveBeenCalledWith('node-1');
  });

  it('awaits source navigation so failures remain visible to ActionInvoker', async () => {
    const onRevealNodeSource = vi.fn(async () => undefined);
    const bundle = actions({ onRevealNodeSource });
    const action = bundle.actions.find(({ id }) => id === 'mindmap.ai.reveal-node-source');

    await action!.execute(invocation());
    expect(onRevealNodeSource).toHaveBeenCalledWith('node-1');
  });
});
