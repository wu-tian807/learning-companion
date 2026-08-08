import type { JsonValue } from '../../../shared/workbench/protocol';
import type {
  PreparedGenerationAssetReferenceBindings,
} from './generation-asset-reference';
import type { AgentUserMessage } from './agent-message';
import type { PreparedAgentWorkspaces } from './generation-workspace';
import type { GenerationValidationResult } from './generation-validation';

export interface PreparedInstructionContext {
  readonly taskId: string;
  readonly projectId: string;
  readonly workspaces: PreparedAgentWorkspaces;
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
}

export abstract class GenerationInstruction<
  TSnapshot extends JsonValue = JsonValue,
> {
  abstract toSnapshot(): TSnapshot;

  abstract toUserMessage(
    context: PreparedInstructionContext,
  ): AgentUserMessage;
}

export interface GenerationInstructionFactory<
  TInstruction extends GenerationInstruction,
> {
  parse(input: JsonValue): GenerationValidationResult<TInstruction>;
}
