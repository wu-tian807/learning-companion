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

export interface WorkbenchConversationContextProvider {
  readonly id: string;
  prepare(
    context: GenerationTaskProcessContext<WorkbenchConversationInstruction>,
  ): Promise<PreparedWorkbenchConversationContext>;
  commitAnswer?(
    context: GenerationTaskProcessContext<WorkbenchConversationInstruction>,
    answer: WorkbenchConversationAnswer,
  ): Promise<JsonValue | undefined>;
}
