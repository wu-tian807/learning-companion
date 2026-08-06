import type { JsonValue } from '../../shared/workbench/protocol';
import type { AgentSessionLocator } from '../agents/sessions/agent-session';
import type { AgentUserMessage } from './contracts/agent-message';
import type { GenerationTokenUsage } from './contracts/generation-metrics';
import type { AllowedToolConfig } from './contracts/task-definition';
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
  readonly projectId: string;
  readonly sessionLocator: AgentSessionLocator;
  readonly sessionId?: string;
  readonly systemInstruction: string;
  readonly userMessage: AgentUserMessage;
  readonly allowedTools: readonly AllowedToolConfig[];
  readonly workspaces: PreparedAgentWorkspaces;
  readonly outputSchema: JsonValue;
  readonly signal?: AbortSignal;
}

export interface GenerationAgentTurnResult {
  readonly output: JsonValue;
  readonly sessionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly providerExecutionId?: string;
  readonly startedTime: number;
  readonly completedTime: number;
  readonly activeDurationMs: number;
  readonly usage?: GenerationTokenUsage;
}

export interface GenerationAgentRunner {
  readonly providerId: string;

  runTurn(
    request: GenerationAgentTurnRequest,
  ): AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult>;
}

export interface GenerationAgentRunnerResolver {
  resolveRunner(providerId?: string): Promise<GenerationAgentRunner>;
}
