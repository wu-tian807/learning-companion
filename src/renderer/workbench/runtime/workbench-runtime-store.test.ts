import { describe, expect, it } from 'vitest';

import type { WorkbenchInteractionContext } from '../../../shared/workbench/interaction';
import { createWorkbenchRuntimeStore } from './workbench-runtime-store';

const identity = {
  projectId: 'project-1',
  assetId: 'asset-1',
  workbenchId: 'builtin.pdf',
  sessionId: 'session-1',
};

function context(
  overrides: Partial<WorkbenchInteractionContext> = {},
): WorkbenchInteractionContext {
  return {
    ...identity,
    selection: {
      text: '选区',
      target: {
        scope: 'content',
        anchorType: 'pdf.text-range',
        anchorVersion: 1,
        anchorPayload: { pageNumber: 1 },
      },
    },
    ...overrides,
  };
}

describe('Workbench runtime store', () => {
  it('accepts interaction only from the active session', () => {
    const store = createWorkbenchRuntimeStore();
    store.getState().activate(identity);

    expect(store.getState().publishInteraction(context())).toBe(true);
    expect(store.getState().interaction.selection?.text).toBe('选区');
    expect(
      store
        .getState()
        .publishInteraction(context({ sessionId: 'stale-session' })),
    ).toBe(false);
    expect(store.getState().interaction.selection?.text).toBe('选区');
  });

  it('clears interaction, menu and busy state on activation change', () => {
    const store = createWorkbenchRuntimeStore();
    store.getState().activate(identity);
    store.getState().publishInteraction(context());
    store.getState().setActionBusy('pdf.zoom-in', true);

    store.getState().activate({
      ...identity,
      assetId: 'asset-2',
      sessionId: 'session-2',
    });

    expect(store.getState().interaction).toEqual({});
    expect(store.getState().contextMenu).toBeUndefined();
    expect(store.getState().busyActionIds.size).toBe(0);
  });

  it('ignores stale deactivation and context menus', () => {
    const store = createWorkbenchRuntimeStore();
    store.getState().activate(identity);

    store.getState().deactivate('stale-session');
    expect(store.getState().identity).toEqual(identity);
    expect(
      store.getState().openContextMenu({
        x: 20,
        y: 30,
        invocation: {
          ...identity,
          origin: 'context-menu',
          sessionId: 'stale-session',
        },
      }),
    ).toBe(false);
  });
});
