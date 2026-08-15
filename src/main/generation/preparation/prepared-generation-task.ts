import type { AgentUserMessage } from '../contracts/agent-message';
import type { PreparedGenerationAssetReferenceBindings } from '../contracts/generation-asset-reference';
import type { GenerationInstruction } from '../contracts/generation-instruction';
import type { PreparedAgentWorkspaces } from '../contracts/generation-workspace';

export interface PreparedGenerationTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly providerSelectorId: string;
  readonly instruction: GenerationInstruction;
  readonly preparedUserMessage: AgentUserMessage;
  readonly workspaces: PreparedAgentWorkspaces;
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
}
