// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  applyEpubAnnotationWaves,
  epubAnnotationWaveStyles,
} from './epub-annotation-wave';
import { isEpubMarkerColor } from './epub-marker-style';

describe('EPUB annotation waves', () => {
  it('converts EPUB.js straight underline segments into colored wave paths', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <svg>
        <g stroke="black" data-epub-annotation-wave="true" data-epub-wave-source="line" data-epub-wave-color="#ef4444">
          <rect x="10" y="8" width="24" height="12" fill="none" />
          <line x1="10" x2="34" y1="20" y2="20" />
        </g>
      </svg>
    `;

    applyEpubAnnotationWaves(host);

    const path = host.querySelector('path');
    expect(host.querySelector('line')).toBeNull();
    expect(host.querySelector('rect')).toBeNull();
    expect(path?.getAttribute('d')).toContain('Q');
    expect(path?.getAttribute('d')).toMatch(/^M 10 20 /);
    expect(path?.getAttribute('d')).toMatch(/34 20$/);
    expect(path?.getAttribute('stroke')).toBe('#ef4444');
  });

  it('turns a note highlight rectangle into a wave without changing its range data', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <svg>
        <g data-reading-note-id="note-1" data-epub-annotation-wave="true" data-epub-wave-source="rect" data-epub-wave-color="#eab308">
          <rect x="4" y="8" width="24" height="12" />
        </g>
      </svg>
    `;

    applyEpubAnnotationWaves(host);

    expect(host.querySelector('rect')).toBeNull();
    expect(host.querySelector('path')?.getAttribute('stroke')).toBe('#eab308');
    expect(
      host.querySelector('g')?.getAttribute('data-reading-note-id'),
    ).toBe('note-1');
  });

  it('uses rect geometry for an AI underline and removes its straight line', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <svg>
        <g data-explanation-id="explanation-1" data-epub-annotation-wave="true" data-epub-wave-source="rect" data-epub-wave-color="#3b82f6" data-epub-wave-lane="1">
          <rect x="4" y="8" width="24" height="12" fill="none" />
          <line x1="4" x2="28" y1="19" y2="19" />
        </g>
      </svg>
    `;

    applyEpubAnnotationWaves(host);

    expect(host.querySelector('rect')).toBeNull();
    expect(host.querySelector('line')).toBeNull();
    expect(host.querySelectorAll('path')).toHaveLength(1);
    expect(host.querySelector('path')?.getAttribute('d')).toMatch(
      /^M 4 25 /,
    );

    const group = host.querySelector('g');
    if (!group) throw new Error('missing annotation group');
    group.innerHTML = `
      <rect x="4" y="12" width="30" height="14" fill="none" />
      <line x1="4" x2="34" y1="25" y2="25" />
    `;
    applyEpubAnnotationWaves(host);

    expect(host.querySelector('line')).toBeNull();
    expect(host.querySelectorAll('path')).toHaveLength(1);
    expect(host.querySelector('path')?.getAttribute('d')).toMatch(
      /^M 4 31 /,
    );
  });

  it('moves overlapping waves downward and exposes the supported colors', () => {
    const first = epubAnnotationWaveStyles(0, 'blue');
    const second = epubAnnotationWaveStyles(1, 'red');

    expect(first['data-epub-wave-lane']).toBe('0');
    expect(second['data-epub-wave-lane']).toBe('1');
    expect(first.stroke).toBe('none');
    expect(first['data-epub-wave-color']).not.toBe(
      second['data-epub-wave-color'],
    );
    expect(isEpubMarkerColor('white')).toBe(true);
    expect(isEpubMarkerColor('black')).toBe(true);
    expect(isEpubMarkerColor('red')).toBe(true);
    expect(isEpubMarkerColor('yellow')).toBe(true);
    expect(isEpubMarkerColor('blue')).toBe(true);
    expect(isEpubMarkerColor('green')).toBe(false);
  });
});
