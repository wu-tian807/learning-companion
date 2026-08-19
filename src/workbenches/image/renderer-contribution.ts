import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { imageWorkbenchManifest } from './shared';

export const imageRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: imageWorkbenchManifest,
    load: async () => (await import('./renderer')).imageRendererWorkbenchModule,
  });
