import { describe, expect, it } from 'vitest';

import {
  isWorkbenchInteractionInput,
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
      focus: selection.target,
      inputs: [
        {
          type: 'core.input.text-selection',
          version: 1,
          target: selection.target,
          payload: { text: selection.text },
        },
      ],
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
        focus: { scope: 'asset' },
        inputs: [],
      }),
    ).toBe(false);
    expect(
      isWorkbenchInvocationContext({
        projectId: 'project-1',
        assetId: 'asset-1',
        workbenchId: 'builtin.pdf',
        sessionId: 'session-1',
        origin: 'toolbar',
        inputs: [],
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
        inputs: [],
      }),
    ).toBe(false);
  });

  it('accepts extensible inputs and rejects invalid input envelopes', () => {
    expect(
      isWorkbenchInteractionInput({
        type: 'test.input.region-selection',
        version: 1,
        target: selection.target,
        payload: {
          x: 0.2,
          y: 0.3,
          width: 0.4,
          height: 0.1,
        },
      }),
    ).toBe(true);
    expect(
      isWorkbenchInteractionInput({
        type: 'region',
        version: 1,
        payload: {},
      }),
    ).toBe(false);
  });
});
