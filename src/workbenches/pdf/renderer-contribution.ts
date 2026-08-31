import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { pdfWorkbenchManifest } from './shared';

export const pdfRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: pdfWorkbenchManifest,
    load: async () => (await import('./renderer')).default,
  });
