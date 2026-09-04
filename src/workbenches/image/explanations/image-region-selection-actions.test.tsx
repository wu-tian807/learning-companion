// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { ImageRegionSelectionActions } from './image-region-selection-actions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('ImageRegionSelectionActions', () => {
  it('offers fixed explanation and free-form questioning for one selected region', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onExplain = vi.fn();
    const onAsk = vi.fn();

    act(() => root.render(
      <ImageRegionSelectionActions
        busy={false}
        onExplain={onExplain}
        onAsk={onAsk}
        onReselect={vi.fn()}
        onCancel={vi.fn()}
      />,
    ));

    const buttons = [...container.querySelectorAll('button')];
    act(() => buttons.find((button) => button.textContent === '自由提问')?.click());
    expect(onAsk).toHaveBeenCalledOnce();
    expect(onExplain).not.toHaveBeenCalled();
    expect(buttons.map((button) => button.textContent)).toEqual([
      'AI 解释',
      '自由提问',
      '重选',
      '取消',
    ]);
    act(() => root.unmount());
  });

  it('disables both AI launches while another conversation is busy', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => root.render(
      <ImageRegionSelectionActions
        busy
        onExplain={vi.fn()}
        onAsk={vi.fn()}
        onReselect={vi.fn()}
        onCancel={vi.fn()}
      />,
    ));
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.slice(0, 2).every((button) => button.disabled)).toBe(true);
    expect(buttons.slice(2).every((button) => !button.disabled)).toBe(true);
    act(() => root.unmount());
  });
});
