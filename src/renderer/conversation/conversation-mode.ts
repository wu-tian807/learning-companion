import type {
  GenerationTaskView,
  StartGenerationTaskRequest,
} from '../../shared/generation-tasks';
import type { ComponentType } from 'react';

import type { ConversationTaskInput } from './conversation-contracts';

export interface ConversationTaskCompletion {
  readonly answer: string;
  readonly title?: string;
  readonly modelInfo?: string;
}

/** Bridges the reusable conversation lifecycle to one GenerationTask protocol. */
export interface ConversationTaskAdapter {
  createRequest(input: ConversationTaskInput): StartGenerationTaskRequest;
  readCompletion(
    task: GenerationTaskView,
  ): ConversationTaskCompletion | undefined;
}

export interface ConversationModePresentation {
  readonly title: string;
  readonly ariaLabel: string;
  readonly emptyLabel: string;
  readonly inputPlaceholder: string;
  readonly allowNewConversation?: boolean;
  readonly newConversationLabel?: string;
  readonly status?: ComponentType<ConversationModeStatusProps>;
}

export interface ConversationModeStatusProps {
  readonly projectId: string;
  readonly boundAssetId?: string;
  /** Changes when the conversation is persisted, allowing an owner status to refresh. */
  readonly refreshKey: number;
}

/**
 * Stable behavior contract for one conversation use case. UI surfaces may
 * render it differently while sharing the same controller and task lifecycle.
 */
export interface ConversationModeDefinition {
  readonly id: string;
  readonly task: ConversationTaskAdapter;
  readonly presentation: ConversationModePresentation;
}
