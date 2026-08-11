import type { JsonValue } from '../../shared/workbench/protocol';
import type { AgentSessionLocator } from '../agents/sessions/agent-session';
import type { AgentUserMessage } from './contracts/agent-message';
import type { GenerationTokenUsage } from './contracts/generation-metrics';
import type {
  AgentMcpServerRequirement,
  AgentSkillRequirement,
  AgentToolRequirement,
  TaskOutputMode,
} from './contracts/task-definition';
import type { PreparedAgentWorkspaces } from './contracts/generation-workspace';

export type GenerationAgentEvent =
  | {
      readonly type: 'session-resolved';
      readonly sessionId: string;
    }
  | {
      readonly type: 'assistant-delta';
      readonly delta: string;
    }
  | {
      readonly type: 'assistant-completed';
      readonly text: string;
    }
  | {
      readonly type: 'usage-updated';
      readonly usage: GenerationTokenUsage;
    }
  | {
      readonly type: 'tool-call';
      readonly phase: 'started' | 'completed';
      readonly callId: string;
      readonly toolName: string;
      readonly payload?: JsonValue;
    }
  | {
      readonly type: 'status';
      readonly message: string;
    };

export interface GenerationAgentTurnRequest {
  readonly taskId: string;
  readonly callKey: string;
  readonly projectId: string;
  readonly sessionLocator: AgentSessionLocator;
  readonly sessionId?: string;
  readonly modelId?: string;
  readonly reasoningEffort?: string;
  readonly systemInstruction: string;
  readonly outputMode: TaskOutputMode;
  readonly userMessage: AgentUserMessage;
  readonly toolRequirements: readonly AgentToolRequirement[];
  readonly skills: readonly AgentSkillRequirement[];
  readonly mcpServers: readonly AgentMcpServerRequirement[];
  readonly workspaces: PreparedAgentWorkspaces;
  readonly signal?: AbortSignal;
}

export interface GenerationAgentTurnResult {
  readonly sessionId: string;
  readonly providerId: string;
  readonly connectionId: string;
  readonly modelId: string;
  readonly providerExecutionId?: string;
  readonly startedTime: number;
  readonly completedTime: number;
  readonly activeDurationMs: number;
  /** Canonical final assistant response. Streaming is optional. */
  readonly assistantOutput: string;
  readonly usage?: GenerationTokenUsage;
}

export interface GenerationAgentRunner {
  readonly providerId: string;
  readonly connectionId: string;

  runTurn(
    request: GenerationAgentTurnRequest,
  ): AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult>;
}

export interface GenerationAgentRunnerResolver {
  resolveSelectorConfiguration(
    selectorId: string,
  ): GenerationAgentExecutionConfiguration;
  resolveRunner(
    configuration: GenerationAgentExecutionConfiguration,
  ): Promise<GenerationAgentRunner>;
}

export interface GenerationAgentExecutionConfiguration {
  readonly providerId: string;
  readonly connectionId: string;
  readonly modelId?: string;
  readonly reasoningEffort?: string;
}
