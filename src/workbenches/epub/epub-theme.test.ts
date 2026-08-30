// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  EPUB_THEME_STYLE_ID,
  applyEpubRenditionAppearance,
  applyEpubThemeToDocument,
} from './epub-theme';

function contentDocument(): Document {
  return document.implementation.createHTMLDocument('EPUB chapter');
}

describe('EPUB live theme switching', () => {
  it('replaces one theme stylesheet when switching dark to light and back', () => {
    const chapter = contentDocument();

    applyEpubThemeToDocument(chapter, 'dark');
    const style = chapter.getElementById(EPUB_THEME_STYLE_ID);
    expect(style?.textContent).toContain('#151a20');

    applyEpubThemeToDocument(chapter, 'light');
    expect(chapter.getElementById(EPUB_THEME_STYLE_ID)).toBe(style);
    expect(style?.textContent).toContain('#f7f5ef');
    expect(style?.textContent).not.toContain('#151a20');

    applyEpubThemeToDocument(chapter, 'dark');
    expect(chapter.querySelectorAll(`#${EPUB_THEME_STYLE_ID}`)).toHaveLength(1);
    expect(style?.textContent).toContain('#151a20');
    expect(style?.textContent).not.toContain('#f7f5ef');
  });

  it('updates every displayed chapter and keeps font scaling on EPUB.js', () => {
    const first = contentDocument();
    const second = contentDocument();
    const fontSize = vi.fn();

    applyEpubRenditionAppearance(
      {
        getContents: () => [{ document: first }, { document: second }],
        themes: { fontSize },
      },
      'sepia',
      1.25,
    );

    expect(first.getElementById(EPUB_THEME_STYLE_ID)?.textContent).toContain(
      '#f2ead7',
    );
    expect(second.getElementById(EPUB_THEME_STYLE_ID)?.textContent).toContain(
      '#f2ead7',
    );
    expect(fontSize).toHaveBeenCalledWith('125%');
  });

  it('still applies appearance safely before a chapter is displayed', () => {
    const fontSize = vi.fn();

    expect(() =>
      applyEpubRenditionAppearance(
        { getContents: () => [], themes: { fontSize } },
        'light',
        1,
      ),
    ).not.toThrow();
    expect(fontSize).toHaveBeenCalledWith('100%');
  });
});
