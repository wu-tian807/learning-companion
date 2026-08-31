import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { videoWorkbenchManifest } from './shared';

export const videoRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: videoWorkbenchManifest,
    load: async () => (await import('./renderer')).default,
  });
