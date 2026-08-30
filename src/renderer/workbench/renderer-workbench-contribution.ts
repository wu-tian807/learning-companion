import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import type { JsonValue } from '../../shared/workbench/protocol';
import type { ConversationContextPresentation } from '../conversation/conversation-contracts';
import type { RendererWorkbenchLoader } from './renderer-workbench-registry';

export interface RendererConversationContextPresenter {
  readonly contributionId: string;
  readonly contextProviderId: string;
  describe(context: JsonValue): ConversationContextPresentation;
}

export interface RendererWorkbenchContribution {
  readonly manifest: AssetWorkbenchManifest;
  readonly load: RendererWorkbenchLoader;
  /** Pure history presentation; available without mounting the Workbench view. */
  readonly conversationContextPresenter?: RendererConversationContextPresenter;
}

export function defineRendererWorkbenchContribution(
  contribution: RendererWorkbenchContribution,
): RendererWorkbenchContribution {
  return Object.freeze(contribution);
}
