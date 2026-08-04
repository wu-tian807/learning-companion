import type { JsonValue } from '../../../shared/workbench/protocol';
import type { AgentUserMessage } from '../contracts/agent-message';
import type { PreparedGenerationAssetReferenceBindings } from '../contracts/generation-asset-reference';
import type { GenerationInstruction } from '../contracts/generation-instruction';
import type { GenerationOutputContract } from '../contracts/generation-output-contract';
import type { AllowedToolConfig } from '../contracts/task-definition';
import type { PreparedAgentWorkspaces } from '../contracts/generation-workspace';

export interface PreparedGenerationTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly instruction: GenerationInstruction;
  readonly systemInstruction: string;
  readonly userMessage: AgentUserMessage;
  readonly allowedTools: readonly AllowedToolConfig[];
  readonly workspaces: PreparedAgentWorkspaces;
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  readonly preparedData?: JsonValue;
  readonly outputContract: GenerationOutputContract<unknown>;
  readonly manifestRef: string;
}
