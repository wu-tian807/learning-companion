import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { audioWorkbenchManifest } from './shared';

export const audioRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: audioWorkbenchManifest,
    load: async () => (await import('./renderer')).default,
  });
