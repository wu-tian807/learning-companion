import type { EpubFlow } from './shared';

export function stabilizeEpubContinuousScroll(
  host: HTMLElement,
  flow: EpubFlow,
): void {
  const containers = host.querySelectorAll<HTMLElement>('.epub-container');
  if (flow !== 'scrolled-doc') {
    host.style.removeProperty('overflow-anchor');
    for (const container of containers) {
      container.style.removeProperty('overflow-anchor');
    }
    return;
  }

  // Chromium's automatic scroll anchoring and EPUB.js continuous manager's
  // own prepend compensation otherwise both adjust scrollTop at a chapter
  // boundary, which makes upward wheel scrolling jump by roughly one chapter.
  host.style.overflowAnchor = 'none';
  for (const container of containers) {
    container.style.overflowAnchor = 'none';
  }
}
