import type { AssetSnapshot } from '../../shared/assets';

export interface RendererGenerationToolResult {
  readonly assetId?: string;
  readonly conversationId?: string;
  readonly modeId?: string;
  readonly boundAssetId?: string;
}

export interface RendererGenerationToolContext {
  readonly projectId: string;
  readonly sourceAssets: readonly AssetSnapshot[];
}

export interface RendererGenerationToolDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly requiresSources?: boolean;
  readonly sourceScope?: 'imported' | 'generated';
  readonly acceptsSource?: (asset: AssetSnapshot) => boolean;
  activate(
    context: RendererGenerationToolContext,
  ): Promise<RendererGenerationToolResult | undefined>;
}
