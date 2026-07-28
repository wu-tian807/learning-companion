import { describe, expect, it, vi } from 'vitest';

import { WorkbenchRuntime } from './workbench-runtime';

const identity = {
  projectId: 'project-1',
  assetId: 'asset-1',
  workbenchId: 'builtin.plain-text',
  sessionId: 'session-1',
};

describe('WorkbenchRuntime', () => {
  it('publishes the frozen right-click interaction for other surfaces', () => {
    const runtime = new WorkbenchRuntime(vi.fn());
    runtime.activate(identity);
    const selection = {
      text: '当前选区',
      target: {
        scope: 'content' as const,
        anchorType: 'plain-text.text-range',
        anchorVersion: 1,
        anchorPayload: {
          ranges: [{ start: 0, end: 4 }],
        },
      },
    };

    expect(
      runtime.openContextMenu(
        identity.sessionId,
        { x: 20, y: 30 },
        {
          target: selection.target,
          selection,
        },
      ),
    ).toBe(true);
    expect(runtime.interactionContext()?.selection?.text).toBe(
      '当前选区',
    );
  });

  it('does not publish an interaction from a stale session', () => {
    const runtime = new WorkbenchRuntime(vi.fn());
    runtime.activate(identity);

    expect(
      runtime.openContextMenu(
        'stale-session',
        { x: 20, y: 30 },
        {},
      ),
    ).toBe(false);
    expect(runtime.interactionContext()?.selection).toBeUndefined();
  });

  it('preserves the pointer-capture policy for embedded content menus', () => {
    const runtime = new WorkbenchRuntime(vi.fn());
    runtime.activate(identity);

    expect(
      runtime.openContextMenu(
        identity.sessionId,
        { x: 20, y: 30 },
        {},
        { captureOutsidePointer: true },
      ),
    ).toBe(true);
    expect(
      runtime.store.getState().contextMenu?.captureOutsidePointer,
    ).toBe(true);
  });
});
