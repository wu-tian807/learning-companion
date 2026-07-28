import { describe, expect, it } from 'vitest';

import {
  isWorkbenchInteractionContext,
  isWorkbenchInteractionSnapshot,
  isWorkbenchInvocationContext,
} from './interaction';

const selection = {
  text: '选中的正文',
  target: {
    scope: 'content' as const,
    anchorType: 'pdf.text-range',
    anchorVersion: 1,
    anchorPayload: { pageNumber: 1 },
  },
};

describe('Workbench interaction contract', () => {
  it('accepts serializable interaction and invocation contexts', () => {
    const context = {
      projectId: 'project-1',
      assetId: 'asset-1',
      workbenchId: 'builtin.pdf',
      sessionId: 'session-1',
      target: selection.target,
      selection,
    };

    expect(isWorkbenchInteractionSnapshot(context)).toBe(true);
    expect(isWorkbenchInteractionContext(context)).toBe(true);
    expect(
      isWorkbenchInvocationContext({
        ...context,
        origin: 'context-menu',
      }),
    ).toBe(true);
  });

  it('rejects asset-level targets and invalid invocation origins', () => {
    expect(
      isWorkbenchInteractionSnapshot({
        target: { scope: 'asset' },
      }),
    ).toBe(false);
    expect(
      isWorkbenchInvocationContext({
        projectId: 'project-1',
        assetId: 'asset-1',
        workbenchId: 'builtin.pdf',
        sessionId: 'session-1',
        origin: 'toolbar',
      }),
    ).toBe(false);
  });

  it('requires complete active session identity', () => {
    expect(
      isWorkbenchInteractionContext({
        projectId: 'project-1',
        assetId: '',
        workbenchId: 'builtin.pdf',
        sessionId: 'session-1',
      }),
    ).toBe(false);
  });
});
