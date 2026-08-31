import type { Rendition } from 'epubjs';

import type { EpubFlow } from './shared';

export interface EpubReadingLocationRestore {
  readonly display: (
    rendition: Pick<Rendition, 'display'>,
  ) => Promise<void>;
  readonly shouldPersistRelocation: () => boolean;
}

export function createEpubReadingLocationRestore(
  flow: EpubFlow,
  location?: string,
): EpubReadingLocationRestore {
  let restoring = location !== undefined;

  return {
    async display(rendition) {
      try {
        await rendition.display(location);
        if (flow === 'scrolled-doc' && location) {
          // The continuous manager fills adjacent sections after its first
          // navigation. Repeating the same CFI after that fill has settled
          // corrects the scroll offset without rebuilding the rendition.
          await rendition.display(location);
        }
      } finally {
        restoring = false;
      }
    },
    shouldPersistRelocation() {
      return !restoring;
    },
  };
}
