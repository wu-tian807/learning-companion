import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { htmlWorkbenchManifest } from './shared';

export const htmlRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: htmlWorkbenchManifest,
    load: async () => (await import('./renderer')).default,
  });
