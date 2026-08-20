import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { epubWorkbenchManifest } from './shared';

export const epubRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: epubWorkbenchManifest,
    load: async () => (await import('./renderer')).default,
  });
