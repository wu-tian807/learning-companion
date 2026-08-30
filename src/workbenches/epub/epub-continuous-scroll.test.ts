// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { stabilizeEpubContinuousScroll } from './epub-continuous-scroll';

describe('EPUB continuous scroll stabilization', () => {
  it('disables Chromium scroll anchoring for the continuous rendition subtree', () => {
    const host = document.createElement('div');
    const container = document.createElement('div');
    container.className = 'epub-container';
    host.append(container);

    stabilizeEpubContinuousScroll(host, 'scrolled-doc');

    expect(host.style.overflowAnchor).toBe('none');
    expect(container.style.overflowAnchor).toBe('none');
  });

  it('leaves paginated rendering unchanged', () => {
    const host = document.createElement('div');
    const container = document.createElement('div');
    container.className = 'epub-container';
    host.append(container);
    host.style.overflowAnchor = 'none';
    container.style.overflowAnchor = 'none';

    stabilizeEpubContinuousScroll(host, 'paginated');

    expect(host.style.overflowAnchor).toBe('');
    expect(container.style.overflowAnchor).toBe('');
  });
});
