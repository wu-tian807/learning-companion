import { describe, expect, it, vi } from 'vitest';

import { createVideoRendererActions } from './renderer-actions';

function createActions(input: { readonly ready?: boolean; readonly count?: number } = {}) {
  return createVideoRendererActions({
    ready: input.ready ?? true,
    canExplainFrame: true,
    explanationCount: input.count ?? 0,
    indexOpen: false,
    markersVisible: true,
    onTogglePlayback: vi.fn(),
    onExplainFrame: vi.fn(),
    onToggleIndex: vi.fn(),
    onToggleMarkers: vi.fn(),
    onReveal: vi.fn(),
  });
}

describe('video renderer annotation actions', () => {
  it('keeps region selection on the existing right-drag context action', () => {
    const bundle = createActions();
    expect(
      bundle.contributions.find(
        (item) => item.id === 'video.ai.explain-frame.context-menu',
      )?.presentation,
    ).toMatchObject({
      label: '解释当前画面',
      description: expect.stringContaining('保存'),
    });
    expect(
      bundle.contributions.some(
        (item) => item.id === 'video.ai.explain-region.header',
      ),
    ).toBe(false);
  });

  it('owns marker count and visibility as header actions', () => {
    const bundle = createActions({ count: 2 });
    expect(
      bundle.contributions
        .filter((item) => item.surface === 'header')
        .map((item) => ({
          label: item.presentation.label,
          badge: item.presentation.badge,
        })),
    ).toEqual([
      { label: '标注', badge: '2' },
      { label: '隐藏标注', badge: '2' },
    ]);
  });

  it('omits all header controls before the video is ready and the marker toggle at zero', () => {
    expect(
      createActions({ ready: false, count: 2 }).contributions.filter(
        (item) => item.surface === 'header',
      ),
    ).toEqual([]);
    expect(
      createActions().contributions.some(
        (item) => item.id === 'video.explanations.toggle-markers.header',
      ),
    ).toBe(false);
  });
});
