import type { JsonValue } from '../../../shared/workbench/protocol';
import type {
  GenerationAssetReferenceSchema,
  PreparedGenerationAssetReferenceBindings,
} from './generation-asset-reference';
import type {
  GenerationInstruction,
  GenerationInstructionFactory,
} from './generation-instruction';
import type { GenerationOutputContract } from './generation-output-contract';
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

export interface GenerationTaskPrepareExtensionContext<
  TInstruction extends GenerationInstruction,
> {
  readonly taskId: string;
  readonly projectId: string;
  readonly instruction: TInstruction;
  readonly workspaces: PreparedAgentWorkspaces;
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  readonly signal?: AbortSignal;
}

export interface GenerationTaskPrepareExtension<
  TInstruction extends GenerationInstruction,
  TPreparedData extends JsonValue,
> {
  prepare(
    context: GenerationTaskPrepareExtensionContext<TInstruction>,
  ): Promise<TPreparedData>;
}

export interface GenerationTaskPostProcessContext<
  TInstruction extends GenerationInstruction,
  TPreparedData extends JsonValue,
> {
  readonly taskId: string;
  readonly projectId: string;
  readonly instruction: TInstruction;
  readonly workspaces: PreparedAgentWorkspaces;
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  readonly preparedData?: TPreparedData;
  readonly signal?: AbortSignal;
}

export interface GenerationTaskPostProcessor<
  TInstruction extends GenerationInstruction,
  TPreparedData extends JsonValue,
  TAgentOutput,
  TResult extends JsonValue,
> {
  postProcess(
    context: GenerationTaskPostProcessContext<TInstruction, TPreparedData>,
    output: TAgentOutput,
  ): Promise<TResult>;
}

export interface TaskDefinition<
  TInstruction extends GenerationInstruction = GenerationInstruction,
  TPreparedData extends JsonValue = JsonValue,
  TAgentOutput = unknown,
  TResult extends JsonValue = JsonValue,
> {
  readonly id: string;
  readonly version: number;
  readonly systemInstruction: string;
  readonly toolRequirements: readonly AgentToolRequirement[];
  readonly skills: readonly AgentSkillRequirement[];
  readonly mcpServers: readonly AgentMcpServerRequirement[];
  readonly primaryWorkspaceConfig: AgentWorkspaceConfig;
  readonly secondaryWorkspaceConfigs: readonly AgentWorkspaceConfig[];
  readonly assetReferenceSchema: GenerationAssetReferenceSchema;
  readonly instruction: GenerationInstructionFactory<TInstruction>;
  readonly prepareExtension?: GenerationTaskPrepareExtension<
    TInstruction,
    TPreparedData
  >;
  readonly outputContract: GenerationOutputContract<TAgentOutput>;
  readonly postProcessor: GenerationTaskPostProcessor<
    TInstruction,
    TPreparedData,
    TAgentOutput,
    TResult
  >;
}

export type AnyTaskDefinition = TaskDefinition<
  GenerationInstruction,
  JsonValue,
  unknown,
  JsonValue
>;
