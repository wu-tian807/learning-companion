import type { JsonValue } from '../../../shared/workbench/protocol';
import type { PreparedGenerationAssetReferenceBindings } from '../../generation/contracts/generation-asset-reference';
import type { PreparedAgentWorkspaces } from '../../generation/contracts/generation-workspace';

export interface AgentFunctionToolExecutionContext {
  readonly taskId: string;
  readonly callKey: string;
  readonly projectId: string;
  readonly executionId: string;
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  readonly workspaces: PreparedAgentWorkspaces;
  readonly signal?: AbortSignal;
}

export class AgentFunctionToolExecutionError extends Error {
  constructor(readonly modelMessage: string) {
    super(modelMessage);
    this.name = 'AgentFunctionToolExecutionError';
  }
}

export type AgentFunctionToolContentItem =
  | {
      readonly type: 'text';
      readonly text: string;
    }
  | {
      readonly type: 'image';
      readonly url: string;
    };

export interface AgentFunctionToolContentResult {
  readonly kind: 'content';
  readonly items: readonly AgentFunctionToolContentItem[];
}

export type AgentFunctionToolExecutionResult =
  | JsonValue
  | AgentFunctionToolContentResult;

export function isAgentFunctionToolContentResult(
  value: AgentFunctionToolExecutionResult,
): value is AgentFunctionToolContentResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'kind' in value &&
    value.kind === 'content' &&
    'items' in value &&
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    value.items.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        ((item.type === 'text' &&
          typeof item.text === 'string') ||
          (item.type === 'image' && typeof item.url === 'string')),
    )
  );
}

export interface AgentFunctionToolDefinition {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  readonly inputSchema: JsonValue;
  readonly deferLoading?: boolean;

  execute(
    input: JsonValue,
    context: AgentFunctionToolExecutionContext,
  ): Promise<AgentFunctionToolExecutionResult>;
}
