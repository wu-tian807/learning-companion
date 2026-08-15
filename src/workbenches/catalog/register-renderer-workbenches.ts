import type {
  RendererWorkbenchLoader,
  RendererWorkbenchRegistry,
} from '../../renderer/workbench/renderer-workbench-registry';
import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import { audioWorkbenchManifest } from '../audio/shared';
import { epubWorkbenchManifest } from '../epub/shared';
import { htmlWorkbenchManifest } from '../html/shared';
import { imageWorkbenchManifest } from '../image/shared';
import { markdownWorkbenchManifest } from '../markdown/shared';
import { mindMapWorkbenchManifest } from '../mindmap/shared';
import { officeWorkbenchManifest } from '../office/shared';
import { pdfWorkbenchManifest } from '../pdf/shared';
import { plainTextWorkbenchManifest } from '../plain-text/shared';
import { videoWorkbenchManifest } from '../video/shared';

export interface RendererWorkbenchContribution {
  readonly manifest: AssetWorkbenchManifest;
  readonly load: RendererWorkbenchLoader;
}

export const rendererWorkbenchContributions: readonly RendererWorkbenchContribution[] = [
  {
    manifest: plainTextWorkbenchManifest,
    load: async () =>
      (await import('../plain-text/renderer')).plainTextRendererWorkbenchModule,
  },
  {
    manifest: markdownWorkbenchManifest,
    load: async () =>
      (await import('../markdown/renderer')).markdownRendererWorkbenchModule,
  },
  {
    manifest: mindMapWorkbenchManifest,
    load: async () =>
      (await import('../mindmap/renderer')).mindMapRendererWorkbenchModule,
  },
  {
    manifest: pdfWorkbenchManifest,
    load: async () => (await import('../pdf/renderer')).default,
  },
  {
    manifest: officeWorkbenchManifest,
    load: async () => (await import('../office/renderer')).default,
  },
  {
    manifest: htmlWorkbenchManifest,
    load: async () => (await import('../html/renderer')).default,
  },
  {
    manifest: epubWorkbenchManifest,
    load: async () => (await import('../epub/renderer')).default,
  },
  {
    manifest: imageWorkbenchManifest,
    load: async () =>
      (await import('../image/renderer')).imageRendererWorkbenchModule,
  },
  {
    manifest: audioWorkbenchManifest,
    load: async () => (await import('../audio/renderer')).default,
  },
  {
    manifest: videoWorkbenchManifest,
    load: async () => (await import('../video/renderer')).default,
  },
];

export function registerRendererWorkbenches(
  registry: Pick<RendererWorkbenchRegistry, 'registerLoader'>,
): void {
  for (const { manifest, load } of rendererWorkbenchContributions) {
    registry.registerLoader(manifest, load);
  }
}
