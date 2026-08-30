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
      rightPanel: 'generation',
    });
    expect(createDefaultProjectLayoutState('medium')).toEqual({
      mode: 'medium',
      leftOpen: true,
      rightPanel: null,
    });
    expect(createDefaultProjectLayoutState('small')).toEqual({
      mode: 'small',
      leftOpen: false,
      rightPanel: null,
    });
  });

  it('keeps small-screen side panels mutually exclusive', () => {
    const small = createDefaultProjectLayoutState('small');
    const leftOpen = reduceProjectLayout(small, {
      type: 'toggle-left',
    });
    const conversationOpen = reduceProjectLayout(leftOpen, {
      type: 'toggle-right',
      panel: 'conversation',
    });
    const generationOpen = reduceProjectLayout(conversationOpen, {
      type: 'toggle-right',
      panel: 'generation',
    });

    expect(leftOpen).toEqual({
      mode: 'small',
      leftOpen: true,
      rightPanel: null,
    });
    expect(conversationOpen).toEqual({
      mode: 'small',
      leftOpen: false,
      rightPanel: 'conversation',
    });
    expect(generationOpen).toEqual({
      mode: 'small',
      leftOpen: false,
      rightPanel: 'generation',
    });
    expect(
      reduceProjectLayout(generationOpen, {
        type: 'close-overlays',
      }),
    ).toEqual(small);
  });

  it('switches the shared right slot instead of opening a fourth column', () => {
    const wide = createDefaultProjectLayoutState('wide');
    const conversation = reduceProjectLayout(wide, {
      type: 'toggle-right',
      panel: 'conversation',
    });
    const generation = reduceProjectLayout(conversation, {
      type: 'open-right',
      panel: 'generation',
    });

    expect(conversation).toEqual({
      mode: 'wide',
      leftOpen: true,
      rightPanel: 'conversation',
    });
    expect(generation).toEqual(wide);
    expect(
      reduceProjectLayout(generation, {
        type: 'toggle-right',
        panel: 'generation',
      }),
    ).toEqual({
      mode: 'wide',
      leftOpen: true,
      rightPanel: null,
    });
  });

  it('opens the source panel idempotently and closes a small-screen generation overlay', () => {
    const wide = createDefaultProjectLayoutState('wide');
    const smallWithGenerationOpen = reduceProjectLayout(
      createDefaultProjectLayoutState('small'),
      { type: 'toggle-right', panel: 'generation' },
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
      rightPanel: null,
    });
  });

  it('resets manual state when the window crosses a mode boundary', () => {
    const collapsedWide = reduceProjectLayout(
      createDefaultProjectLayoutState('wide'),
      { type: 'toggle-right', panel: 'generation' },
    );

    expect(
      reduceProjectLayout(collapsedWide, {
        type: 'mode-changed',
        mode: 'medium',
      }),
    ).toEqual(createDefaultProjectLayoutState('medium'));
  });
});
