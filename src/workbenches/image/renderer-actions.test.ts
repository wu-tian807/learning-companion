import { describe, expect, it, vi } from 'vitest';

import { createImageRendererActions } from './renderer-actions';

function createActions(aiBusy: boolean) {
  return createImageRendererActions({
    ready: true,
    aiBusy,
    explanationCount: 0,
    indexOpen: false,
    markersVisible: true,
    canToggleIndex: true,
    onFit: vi.fn(),
    onActualSize: vi.fn(),
    onRotateClockwise: vi.fn(),
    onRotateCounterclockwise: vi.fn(),
    onReset: vi.fn(),
    onExplainRegion: vi.fn(),
    onToggleIndex: vi.fn(),
    onToggleMarkers: vi.fn(),
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

  it('owns its title-bar controls as header action contributions', () => {
    const onToggleIndex = vi.fn();
    const onToggleMarkers = vi.fn();
    const bundle = createImageRendererActions({
      ready: true,
      explanationCount: 2,
      indexOpen: true,
      markersVisible: false,
      canToggleIndex: true,
      onFit: vi.fn(),
      onActualSize: vi.fn(),
      onRotateClockwise: vi.fn(),
      onRotateCounterclockwise: vi.fn(),
      onReset: vi.fn(),
      onExplainRegion: vi.fn(),
      onToggleIndex,
      onToggleMarkers,
      onReveal: vi.fn(),
    });
    const header = bundle.contributions.filter(
      (contribution) => contribution.surface === 'header',
    );

    expect(
      header.map(({ presentation }) => ({
        label: presentation.label,
        badge: presentation.badge,
        expanded: presentation.expanded,
        checked:
          presentation.kind === 'checkbox'
            ? presentation.checked
            : undefined,
      })),
    ).toEqual([
      {
        label: '框选解释',
        badge: undefined,
        expanded: undefined,
        checked: undefined,
      },
      { label: '标注', badge: '2', expanded: true, checked: undefined },
      { label: '显示标注', badge: '2', expanded: undefined, checked: true },
    ]);

    bundle.actions
      .find((action) => action.id === 'image.explanations.toggle-index')
      ?.execute({} as never);
    bundle.actions
      .find((action) => action.id === 'image.explanations.toggle-markers')
      ?.execute({} as never);
    expect(onToggleIndex).toHaveBeenCalledOnce();
    expect(onToggleMarkers).toHaveBeenCalledOnce();
  });

  it('omits the marker toggle when there are no explanations', () => {
    const bundle = createActions(false);

    expect(
      bundle.contributions.some(
        (contribution) =>
          contribution.id ===
          'image.explanations.toggle-markers.header',
      ),
    ).toBe(false);
  });

  it('keeps title-bar actions absent until the image viewer is ready', () => {
    const bundle = createImageRendererActions({
      ready: false,
      explanationCount: 2,
      onFit: vi.fn(),
      onActualSize: vi.fn(),
      onRotateClockwise: vi.fn(),
      onRotateCounterclockwise: vi.fn(),
      onReset: vi.fn(),
      onExplainRegion: vi.fn(),
      onReveal: vi.fn(),
    });

    expect(
      bundle.contributions.filter(
        (contribution) => contribution.surface === 'header',
      ),
    ).toEqual([]);
  });
});
