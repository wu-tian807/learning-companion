import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { plainTextWorkbenchManifest } from './shared';

export const plainTextRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: plainTextWorkbenchManifest,
    load: async () =>
      (await import('./renderer')).plainTextRendererWorkbenchModule,
  });
