import type { JsonValue } from '../../../shared/workbench/protocol';
import type { AgentUserMessage } from './agent-message';
import type {
  GenerationAssetReferenceSchema,
  PreparedGenerationAssetReferenceBindings,
} from './generation-asset-reference';
import type {
  GenerationInstruction,
  GenerationInstructionFactory,
} from './generation-instruction';
import type {
  GenerationAgentExecutionMetrics,
} from './generation-metrics';
import type { GenerationValidationIssue } from './generation-validation';
import type {
  AgentWorkspaceConfig,
  PreparedAgentWorkspaces,
} from './generation-workspace';

export interface AgentToolRequirement {
  readonly id: string;
  readonly availability: 'required' | 'optional';
}

export interface AgentSkillRequirement {
  readonly id: string;
  readonly availability: 'required' | 'optional';
}

export interface AgentMcpServerRequirement {
  readonly id: string;
  readonly availability: 'required' | 'optional';
}

export interface TaskAgentCallRequest {
  /**
   * Stable logical identity inside one GenerationTask. Reusing the key after
   * recovery returns the persisted call instead of starting another turn.
   */
  readonly callKey: string;
  readonly purpose: string;
  readonly userMessage?: AgentUserMessage;
  /** Final output is always returned; this only controls runtime UI events. */
  readonly assistantEvents?: 'none' | 'runtime';
}

export interface TaskAgentCallResult {
  readonly callKey: string;
  readonly purpose: string;
  readonly sessionId: string;
  readonly providerExecutionId?: string;
  /** Missing only for checkpoints created before final-output persistence. */
  readonly assistantOutput?: string;
  readonly metrics: GenerationAgentExecutionMetrics;
}

/**
 * Agent-call facade injected for one GenerationTask execution. The concrete
 * TaskDefinition chooses the underlying Provider session through its primary
 * Workspace instance key. Definitions can use the taskId default or resolve a
 * stable key to continue the same session across GenerationTasks.
 * Definitions can request multiple sequential turns without knowing how the
 * Provider session is selected and persisted.
 */
export interface TaskAgentSession {
  readonly completedCalls: readonly TaskAgentCallResult[];
  call(request: TaskAgentCallRequest): Promise<TaskAgentCallResult>;
}

export interface GenerationTaskProcessContext<
  TInstruction extends GenerationInstruction,
> {
  readonly taskId: string;
  readonly projectId: string;
  readonly instruction: TInstruction;
  readonly workspaces: PreparedAgentWorkspaces;
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  readonly defaultUserMessage: AgentUserMessage;
  readonly agent: TaskAgentSession;
  readonly signal?: AbortSignal;
  reportStatus(message: string): void;
  reportOutputRejected(
    repairTurnNumber: number,
    issues: readonly GenerationValidationIssue[],
  ): void;
}

export interface GenerationTaskProcessor<
  TInstruction extends GenerationInstruction = GenerationInstruction,
  TResult extends JsonValue = JsonValue,
> {
  process(
    context: GenerationTaskProcessContext<TInstruction>,
  ): Promise<TResult>;
}

export interface TaskDefinition<
  TInstruction extends GenerationInstruction = GenerationInstruction,
  TResult extends JsonValue = JsonValue,
> extends GenerationTaskProcessor<TInstruction, TResult> {
  readonly id: string;
  readonly version: number;
  /** Stable business slot used to resolve the execution configuration. */
  readonly providerSelectorId: string;
  readonly systemInstruction: string;
  readonly toolRequirements: readonly AgentToolRequirement[];
  readonly skills: readonly AgentSkillRequirement[];
  readonly mcpServers: readonly AgentMcpServerRequirement[];
  readonly primaryWorkspaceConfig: AgentWorkspaceConfig;
  readonly secondaryWorkspaceConfigs: readonly AgentWorkspaceConfig[];
  readonly assetReferenceSchema: GenerationAssetReferenceSchema;
  readonly instruction: GenerationInstructionFactory<TInstruction>;
}

export type AnyTaskDefinition = TaskDefinition<
  GenerationInstruction,
  JsonValue
>;
