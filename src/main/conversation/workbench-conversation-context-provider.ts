import type { PreparedAgentWorkspaces } from '../generation/contracts/generation-workspace';
import type { PreparedGenerationAssetReferenceBindings } from '../generation/contracts/generation-asset-reference';
import type { JsonValue } from '../../shared/workbench/protocol';
import type { AgentUserMessage } from '../generation/contracts/agent-message';
import type {
  AgentMcpServerRequirement,
  AgentSkillRequirement,
  AgentToolRequirement,
  GenerationTaskProcessContext,
  TaskAgentCallResult,
} from '../generation/contracts/task-definition';
import type { WorkbenchConversationInstruction } from './workbench-conversation-instruction';

/**
 * Workbench-owned source preparation that can be consumed by a task other
 * than the Workbench's ordinary answer flow. It deliberately has no answer
 * policy, output policy, or commit callback.
 */
export interface WorkbenchConversationMaterialsContext {
  readonly taskId: string;
  readonly projectId: string;
  readonly question: string;
  readonly assetId?: string;
  readonly context?: JsonValue;
  readonly contextSource?: JsonValue;
  readonly workspaces: PreparedAgentWorkspaces;
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  readonly signal?: AbortSignal;
  reportStatus(message: string): void;
}

/** Adapts the generic conversation process context for a material-only call. */
export function materialsContextFromConversation(
  context: GenerationTaskProcessContext<WorkbenchConversationInstruction>,
): WorkbenchConversationMaterialsContext {
  return Object.freeze({
    taskId: context.taskId,
    projectId: context.projectId,
    question: context.instruction.question,
    ...(context.instruction.assetId
      ? { assetId: context.instruction.assetId }
      : {}),
    ...(context.instruction.context === undefined
      ? {}
      : { context: context.instruction.context }),
    workspaces: context.workspaces,
    assetReferences: context.assetReferences,
    ...(context.signal ? { signal: context.signal } : {}),
    reportStatus: context.reportStatus,
  });
}

export interface PreparedWorkbenchConversationMaterials {
  readonly userMessage: AgentUserMessage;
  readonly toolRequirements: readonly AgentToolRequirement[];
  readonly skills?: readonly AgentSkillRequirement[];
  readonly mcpServers?: readonly AgentMcpServerRequirement[];
}

export interface PreparedWorkbenchConversationContext {
  readonly purpose: string;
  readonly statusMessage: string;
  readonly systemInstruction: string;
  readonly userMessage: AgentUserMessage;
  readonly toolRequirements: readonly AgentToolRequirement[];
  readonly skills?: readonly AgentSkillRequirement[];
  readonly mcpServers?: readonly AgentMcpServerRequirement[];
  readonly maximumAnswerLength?: number;
  readonly commitStatusMessage?: string;
}

export interface WorkbenchConversationAnswer {
  readonly answer: string;
  readonly title?: string;
  readonly call: TaskAgentCallResult;
}

export interface WorkbenchMaterialsProvider {
  prepareMaterials(
    context: WorkbenchConversationMaterialsContext,
  ): Promise<PreparedWorkbenchConversationMaterials>;
}

export interface WorkbenchConversationContextProvider extends Partial<WorkbenchMaterialsProvider> {
  readonly id: string;
  prepare(
    context: GenerationTaskProcessContext<WorkbenchConversationInstruction>,
  ): Promise<PreparedWorkbenchConversationContext>;
  commitAnswer?(
    context: GenerationTaskProcessContext<WorkbenchConversationInstruction>,
    answer: WorkbenchConversationAnswer,
  ): Promise<JsonValue | undefined>;
}
