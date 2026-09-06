import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import type { ConversationModeDefinition } from '../conversation/conversation-mode';
import type { RendererGenerationToolDefinition } from '../generation/renderer-generation-tool';
import type { RendererWorkbenchLoader } from './renderer-workbench-registry';

export interface RendererWorkbenchContribution {
  readonly manifest: AssetWorkbenchManifest;
  readonly load: RendererWorkbenchLoader;
  readonly conversationModes?: readonly ConversationModeDefinition[];
  readonly generationTools?: readonly RendererGenerationToolDefinition[];
}

export function defineRendererWorkbenchContribution(
  contribution: RendererWorkbenchContribution,
): RendererWorkbenchContribution {
  return Object.freeze(contribution);
}
