// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { EpubMarkerColorPicker } from './epub-marker-color-picker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('EpubMarkerColorPicker', () => {
  it('offers the five supported colors and reports the selected color', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(
        <EpubMarkerColorPicker value="blue" onChange={onChange} />,
      );
    });

    expect(container.querySelectorAll('button')).toHaveLength(5);
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="红色波浪线"]')
        ?.click(),
    );
    expect(onChange).toHaveBeenCalledWith('red');

    act(() => root.unmount());
  });
});
