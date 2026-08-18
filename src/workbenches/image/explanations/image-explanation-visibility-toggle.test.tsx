// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImageExplanationVisibilityToggle } from './image-explanation-visibility-toggle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ImageExplanationVisibilityToggle', () => {
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

  it('hides itself when there are no saved annotations', () => {
    act(() => root.render(
      <ImageExplanationVisibilityToggle visible count={0} onToggle={vi.fn()} />,
    ));
    expect(container.querySelector('button')).toBeNull();
  });

  it('offers to hide visible annotations without deleting them', () => {
    const onToggle = vi.fn();
    act(() => root.render(
      <ImageExplanationVisibilityToggle visible count={2} onToggle={onToggle} />,
    ));
    const button = container.querySelector<HTMLButtonElement>('button');
    expect(button?.getAttribute('aria-label')).toBe('隐藏标注（2）');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    act(() => button?.click());
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('offers to restore annotations while hidden', () => {
    act(() => root.render(
      <ImageExplanationVisibilityToggle visible={false} count={3} onToggle={vi.fn()} />,
    ));
    const button = container.querySelector<HTMLButtonElement>('button');
    expect(button?.getAttribute('aria-label')).toBe('显示标注（3）');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });
});
