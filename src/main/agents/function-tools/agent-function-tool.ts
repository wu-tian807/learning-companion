import type { JsonValue } from '../../../shared/workbench/protocol';
import type { PreparedAgentWorkspaces } from '../../generation/contracts/generation-workspace';

export interface AgentFunctionToolExecutionContext {
  readonly taskId: string;
  readonly projectId: string;
  readonly workspaces: PreparedAgentWorkspaces;
  readonly signal?: AbortSignal;
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
  ): Promise<JsonValue>;
}
