import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { officeWorkbenchManifest } from './shared';

export const officeRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: officeWorkbenchManifest,
    load: async () => (await import('./renderer')).default,
  });
