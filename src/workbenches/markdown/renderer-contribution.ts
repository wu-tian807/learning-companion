import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { markdownWorkbenchManifest } from './shared';

export const markdownRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: markdownWorkbenchManifest,
    load: async () =>
      (await import('./renderer')).markdownRendererWorkbenchModule,
  });
