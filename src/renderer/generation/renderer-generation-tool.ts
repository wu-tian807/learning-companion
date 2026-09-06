import type { ComponentType } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import type { AssetLoadState } from '../project/project-asset-view';

export interface GeneratedConversationBinding {
  readonly conversationId: string;
  readonly modeId: string;
  readonly boundAssetId: string;
}

export type RendererGenerationToolResult = (
  | { readonly asset: AssetSnapshot; readonly assetId?: never }
  | { readonly assetId: string; readonly asset?: never }
) & { readonly conversation?: GeneratedConversationBinding };

export interface RendererGenerationToolSetupProps {
  readonly projectId: string;
  /** The owning Workbench filters and presents this candidate state. */
  readonly candidateState: AssetLoadState;
  readonly onRetry?: () => void;
  readonly onComplete: (sourceAssets: readonly AssetSnapshot[]) => void;
  readonly onCancel: () => void;
}

export interface RendererGenerationToolContext {
  readonly projectId: string;
  readonly sourceAssets: readonly AssetSnapshot[];
  /** Stable across retries of one create attempt; not a global source dedupe key. */
  readonly requestId?: string;
}

export interface RendererGenerationToolDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly order?: number;
  readonly requiresSources?: boolean;
  readonly sourceScope?: 'imported' | 'generated';
  readonly acceptsSource?: (asset: AssetSnapshot) => boolean;
  readonly setup?: ComponentType<RendererGenerationToolSetupProps>;
  activate(
    context: RendererGenerationToolContext,
  ): Promise<RendererGenerationToolResult | undefined>;
}
