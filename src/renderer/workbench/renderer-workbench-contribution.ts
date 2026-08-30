import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import type { RendererWorkbenchLoader } from './renderer-workbench-registry';

export interface RendererWorkbenchContribution {
  readonly manifest: AssetWorkbenchManifest;
  readonly load: RendererWorkbenchLoader;
}

export function defineRendererWorkbenchContribution(
  contribution: RendererWorkbenchContribution,
): RendererWorkbenchContribution {
  return Object.freeze(contribution);
}
