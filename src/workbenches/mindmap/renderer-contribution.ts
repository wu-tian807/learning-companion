import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { mindMapWorkbenchManifest } from './shared';

export const mindMapRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: mindMapWorkbenchManifest,
    load: async () =>
      (await import('./renderer')).mindMapRendererWorkbenchModule,
  });
