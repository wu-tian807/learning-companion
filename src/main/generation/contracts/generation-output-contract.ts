import type { JsonValue } from '../../../shared/workbench/protocol';
import type { PreparedGenerationAssetReferenceBindings } from './generation-asset-reference';
import type { AgentUserMessage } from './agent-message';
import type { GenerationValidationResult } from './generation-validation';

export interface GenerationOutputValidationContext {
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
}

export interface GenerationOutputContract<TOutput> {
  readonly schema: JsonValue;
  readonly maxRepairTurns: number;

  validate(
    value: JsonValue,
    context: GenerationOutputValidationContext,
  ): GenerationValidationResult<TOutput>;

  createRepairMessage(
    issues: readonly { readonly path: string; readonly message: string }[],
    repairTurnNumber: number,
  ): AgentUserMessage;
}
