import { describe, expect, it } from 'vitest';

import {
  createDefaultProjectLayoutState,
  PROJECT_SMALL_LAYOUT_QUERY,
  PROJECT_WIDE_LAYOUT_QUERY,
  reduceProjectLayout,
  resolveProjectLayoutMode,
} from './use-project-layout';

function createMatchMedia(
  matches: Partial<Record<string, boolean>>,
) {
  return (query: string) => ({
    matches: matches[query] ?? false,
  });
}

describe('Project responsive layout', () => {
  it('resolves wide, medium and small modes from the shared queries', () => {
    expect(
      resolveProjectLayoutMode(
        createMatchMedia({
          [PROJECT_WIDE_LAYOUT_QUERY]: true,
        }),
      ),
    ).toBe('wide');
    expect(resolveProjectLayoutMode(createMatchMedia({}))).toBe(
      'medium',
    );
    expect(
      resolveProjectLayoutMode(
        createMatchMedia({
          [PROJECT_SMALL_LAYOUT_QUERY]: true,
        }),
      ),
    ).toBe('small');
  });

  it('uses the approved defaults for each window mode', () => {
    expect(createDefaultProjectLayoutState('wide')).toEqual({
      mode: 'wide',
      leftOpen: true,
      rightOpen: true,
    });
    expect(createDefaultProjectLayoutState('medium')).toEqual({
      mode: 'medium',
      leftOpen: true,
      rightOpen: false,
    });
    expect(createDefaultProjectLayoutState('small')).toEqual({
      mode: 'small',
      leftOpen: false,
      rightOpen: false,
    });
  });

  it('keeps small-screen overlays mutually exclusive', () => {
    const small = createDefaultProjectLayoutState('small');
    const leftOpen = reduceProjectLayout(small, {
      type: 'toggle-left',
    });
    const rightOpen = reduceProjectLayout(leftOpen, {
      type: 'toggle-right',
    });

    expect(leftOpen).toEqual({
      mode: 'small',
      leftOpen: true,
      rightOpen: false,
    });
    expect(rightOpen).toEqual({
      mode: 'small',
      leftOpen: false,
      rightOpen: true,
    });
    expect(
      reduceProjectLayout(rightOpen, {
        type: 'close-overlays',
      }),
    ).toEqual(small);
  });

  it('opens the source panel idempotently and closes a small-screen generation overlay', () => {
    const wide = createDefaultProjectLayoutState('wide');
    const smallWithGenerationOpen = reduceProjectLayout(
      createDefaultProjectLayoutState('small'),
      { type: 'toggle-right' },
    );

    expect(
      reduceProjectLayout(wide, { type: 'open-left' }),
    ).toBe(wide);
    expect(
      reduceProjectLayout(smallWithGenerationOpen, {
        type: 'open-left',
      }),
    ).toEqual({
      mode: 'small',
      leftOpen: true,
      rightOpen: false,
    });
  });

  it('resets manual state when the window crosses a mode boundary', () => {
    const collapsedWide = reduceProjectLayout(
      createDefaultProjectLayoutState('wide'),
      { type: 'toggle-right' },
    );

    expect(
      reduceProjectLayout(collapsedWide, {
        type: 'mode-changed',
        mode: 'medium',
      }),
    ).toEqual(createDefaultProjectLayoutState('medium'));
  });
});
