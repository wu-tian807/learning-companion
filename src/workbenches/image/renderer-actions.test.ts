import { describe, expect, it, vi } from 'vitest';

import { createImageRendererActions } from './renderer-actions';

function createActions(aiBusy: boolean) {
  return createImageRendererActions({
    ready: true,
    aiBusy,
    onFit: vi.fn(),
    onActualSize: vi.fn(),
    onRotateClockwise: vi.fn(),
    onRotateCounterclockwise: vi.fn(),
    onReset: vi.fn(),
    onExplainRegion: vi.fn(),
    onReveal: vi.fn(),
  });
}

describe('image renderer AI actions', () => {
  it('allows a region explanation while the image conversation is idle', () => {
    const bundle = createActions(false);
    expect(bundle.actions.find((action) => action.id === 'image.ai.explain-region')?.enabled)
      .toBe(true);
  });

  it('blocks another region explanation while a conversation answer is running', () => {
    const bundle = createActions(true);
    expect(bundle.actions.find((action) => action.id === 'image.ai.explain-region')?.enabled)
      .toBe(false);
    expect(bundle.contributions.find((item) => item.id === 'image.ai.explain-region.context-menu')?.presentation.disabledReason)
      .toContain('当前 AI 回答');
  });
});
