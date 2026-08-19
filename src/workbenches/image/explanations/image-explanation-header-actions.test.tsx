// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImageExplanationHeaderActions } from './image-explanation-header-actions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ImageExplanationHeaderActions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps all available image explanation actions together', () => {
    const onStartSelection = vi.fn();
    const onToggleIndex = vi.fn();
    const onToggleMarkers = vi.fn();
    act(() => root.render(
      <ImageExplanationHeaderActions
        explanationCount={2}
        indexOpen={false}
        markersVisible
        canStartSelection
        canToggleIndex
        onStartSelection={onStartSelection}
        onToggleIndex={onToggleIndex}
        onToggleMarkers={onToggleMarkers}
      />,
    ));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((button) => button.textContent)).toEqual([
      '框选解释',
      '标注2',
      '隐藏标注2',
    ]);
    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());
    act(() => buttons[2]?.click());
    expect(onStartSelection).toHaveBeenCalledOnce();
    expect(onToggleIndex).toHaveBeenCalledOnce();
    expect(onToggleMarkers).toHaveBeenCalledOnce();
  });

  it('disables a new selection while another image operation is active', () => {
    act(() => root.render(
      <ImageExplanationHeaderActions
        explanationCount={0}
        indexOpen
        markersVisible
        canStartSelection={false}
        canToggleIndex={false}
        onStartSelection={vi.fn()}
        onToggleIndex={vi.fn()}
        onToggleMarkers={vi.fn()}
      />,
    ));
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    expect(container.querySelectorAll<HTMLButtonElement>('button')[1]?.disabled).toBe(true);
    expect(container.textContent).toBe('框选解释标注0');
  });
});
