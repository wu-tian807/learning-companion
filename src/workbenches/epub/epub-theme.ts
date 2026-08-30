import type { EpubTheme } from './shared';

export const EPUB_THEME_STYLE_ID = 'learning-companion-epub-theme';

interface EpubThemePalette {
  readonly background: string;
  readonly foreground: string;
  readonly muted: string;
  readonly link: string;
}

const EPUB_THEME_PALETTES: Readonly<Record<EpubTheme, EpubThemePalette>> =
  Object.freeze({
    dark: {
      background: '#151a20',
      foreground: '#cbd5e1',
      muted: '#94a3b8',
      link: '#a5b4fc',
    },
    light: {
      background: '#f7f5ef',
      foreground: '#292824',
      muted: '#69665e',
      link: '#4f46e5',
    },
    sepia: {
      background: '#f2ead7',
      foreground: '#40392e',
      muted: '#756a58',
      link: '#765caa',
    },
  });

function epubThemeCss(theme: EpubTheme): string {
  const palette = EPUB_THEME_PALETTES[theme];
  return `
html {
  background-color: ${palette.background} !important;
}
body {
  background-color: ${palette.background} !important;
  color: ${palette.foreground} !important;
  line-height: 1.8 !important;
  padding: 0 4% !important;
}
a, a:visited {
  color: ${palette.link} !important;
}
blockquote, figcaption {
  color: ${palette.muted} !important;
}
img, svg {
  max-width: 100% !important;
  height: auto !important;
}
`.trim();
}

export function applyEpubThemeToDocument(
  document: Document,
  theme: EpubTheme,
): void {
  let style = document.getElementById(EPUB_THEME_STYLE_ID);
  if (style?.tagName.toLowerCase() !== 'style') {
    style?.remove();
    style = document.createElement('style');
    style.id = EPUB_THEME_STYLE_ID;
    (document.head ?? document.documentElement).appendChild(style);
  }
  style.textContent = epubThemeCss(theme);
}

export interface EpubAppearanceRendition {
  readonly themes: {
    fontSize(size: string): void;
  };
  getContents():
    | { readonly document: Document }
    | readonly { readonly document: Document }[];
}

export function applyEpubRenditionAppearance(
  rendition: EpubAppearanceRendition,
  theme: EpubTheme,
  fontScale: number,
): void {
  const currentContents = rendition.getContents();
  const displayedContents = Array.isArray(currentContents)
    ? currentContents
    : [currentContents];
  for (const contents of displayedContents) {
    applyEpubThemeToDocument(contents.document, theme);
  }
  rendition.themes.fontSize(`${Math.round(fontScale * 100)}%`);
}
