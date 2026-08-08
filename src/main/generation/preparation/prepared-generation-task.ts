import type { AgentUserMessage } from '../contracts/agent-message';
import type { PreparedGenerationAssetReferenceBindings } from '../contracts/generation-asset-reference';
import type { GenerationInstruction } from '../contracts/generation-instruction';
import type {
  AgentMcpServerRequirement,
  AgentSkillRequirement,
  AgentToolRequirement,
} from '../contracts/task-definition';
import type { PreparedAgentWorkspaces } from '../contracts/generation-workspace';

export interface PreparedGenerationTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly instruction: GenerationInstruction;
  readonly systemInstruction: string;
  readonly defaultUserMessage: AgentUserMessage;
  readonly toolRequirements: readonly AgentToolRequirement[];
  readonly skills: readonly AgentSkillRequirement[];
  readonly mcpServers: readonly AgentMcpServerRequirement[];
  readonly workspaces: PreparedAgentWorkspaces;
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  readonly manifestRef: string;
}
