import { describe, expect, it } from 'vitest';

import {
  assignEpubExplanationLanes,
  epubExplanationUnderlineStyles,
} from './epub-explanation-lanes';

const range = (start: number, end: number) =>
  `epubcfi(/6/4!/4/2,/1:${start},/1:${end})`;

describe('EPUB overlapping explanation lanes', () => {
  it('places overlapping CFI ranges on separate visual lanes', () => {
    expect(
      assignEpubExplanationLanes([
        { id: 'first', cfiRange: range(0, 12) },
        { id: 'second', cfiRange: range(8, 20) },
        { id: 'third', cfiRange: range(21, 30) },
      ]),
    ).toEqual({ first: 0, second: 1, third: 0 });
  });

  it('renders separate lanes with distinct offsets and line patterns', () => {
    expect(epubExplanationUnderlineStyles(0, 'completed')).toMatchObject({
      transform: 'translate(0 0)',
    });
    expect(epubExplanationUnderlineStyles(1, 'completed')).toMatchObject({
      transform: 'translate(0 -2)',
      'stroke-dasharray': '5 2',
    });
  });

  it('uses a deterministic fallback lane for malformed legacy CFI data', () => {
    expect(
      assignEpubExplanationLanes([
        { id: 'first', cfiRange: 'legacy-one' },
        { id: 'second', cfiRange: 'legacy-two' },
      ]),
    ).toEqual({ first: 0, second: 1 });
  });
});
