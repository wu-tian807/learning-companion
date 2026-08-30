import { describe, expect, it } from 'vitest';

import {
  epubExplanationMarkerColor,
  isEpubExplanationMetadata,
} from './shared';

describe('EPUB explanation metadata', () => {
  it('accepts legacy metadata with a blue default and validates custom colors', () => {
    const legacy = {
      format: 'learning-companion/epub-explanation',
      version: 1,
    } as const;
    const customized = { ...legacy, markerColor: 'red' } as const;

    expect(isEpubExplanationMetadata(legacy)).toBe(true);
    expect(epubExplanationMarkerColor(legacy)).toBe('blue');
    expect(isEpubExplanationMetadata(customized)).toBe(true);
    expect(epubExplanationMarkerColor(customized)).toBe('red');
    expect(
      isEpubExplanationMetadata({ ...legacy, markerColor: 'green' }),
    ).toBe(false);
  });
});
