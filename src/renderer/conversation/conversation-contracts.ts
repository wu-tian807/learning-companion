import type {
  GenerationTaskView,
  StartGenerationTaskRequest,
} from '../../shared/generation-tasks';
import type { JsonValue } from '../../shared/workbench/protocol';

export type ConversationRole = 'user' | 'assistant';

export interface ConversationMessageRecord {
  readonly id: string;
  readonly role: ConversationRole;
  readonly text: string;
  readonly createdTime: number;
  readonly replyToMessageId?: string;
  readonly generationTaskId?: string;
  readonly context?: JsonValue;
  readonly modelInfo?: string;
  readonly stopped?: boolean;
}

export interface ConversationRecord {
  readonly id: string;
  readonly title: string;
  readonly messages: readonly ConversationMessageRecord[];
  readonly createdTime: number;
  readonly updatedTime: number;
}

export interface ConversationHistoryStore {
  list(): Promise<readonly ConversationRecord[]>;
  save(record: ConversationRecord): Promise<readonly ConversationRecord[]>;
  remove(conversationId: string): Promise<readonly ConversationRecord[]>;
  subscribe?(listener: () => void): () => void;
  getSnapshot?(): readonly ConversationRecord[];
}

export interface ConversationContextPresentation {
  readonly label: string;
  readonly detail?: string;
  readonly previewDataUrl?: string;
}

export interface ConversationTaskResult {
  readonly answer: string;
  readonly title?: string;
  readonly modelInfo?: string;
}

export interface ConversationTaskInput {
  readonly projectId: string;
  readonly assetId: string;
  readonly conversationId: string;
  readonly question: string;
  readonly context?: JsonValue;
  readonly generateTitle: boolean;
}

export interface ConversationAnswerActionInput {
  readonly projectId: string;
  readonly assetId: string;
  readonly conversation: ConversationRecord;
  readonly answer: ConversationMessageRecord;
  readonly question: ConversationMessageRecord | undefined;
  readonly text: string;
}

/**
 * Renderer contribution supplied by one active Workbench.
 *
 * The shared conversation layer owns task lifecycle and UI projection. The
 * contribution owns media context, TaskDefinition input, result decoding,
 * source location and optional media actions such as creating Attachments.
 */
export interface WorkbenchConversationContribution {
  readonly id: string;
  readonly workbenchId: string;
  readonly title: string;
  readonly emptyLabel: string;
  readonly inputPlaceholder?: string;
  readonly historyStore: ConversationHistoryStore;
  createTaskRequest(input: ConversationTaskInput): StartGenerationTaskRequest;
  readTaskResult(task: GenerationTaskView): ConversationTaskResult | undefined;
  describeContext?(context: JsonValue): ConversationContextPresentation;
  revealContext?(context: JsonValue): Promise<void> | void;
  /** Clears Workbench-owned transient context UI after send, discard, restore or close. */
  onContextReleased?(context: JsonValue | undefined): void;
  attachAnswer?(input: ConversationAnswerActionInput): Promise<void> | void;
}

export interface ConversationLaunchRequest {
  readonly id: number;
  readonly conversationId?: string;
  readonly context?: JsonValue;
  readonly question?: string;
  readonly submit?: boolean;
}

export interface ActiveWorkbenchConversationContribution {
  readonly ownerId: string;
  readonly contribution: WorkbenchConversationContribution;
}

export interface WorkbenchConversationRuntimeSnapshot {
  readonly active?: ActiveWorkbenchConversationContribution;
  readonly panelOpen: boolean;
  readonly busy: boolean;
  readonly launchRequest?: ConversationLaunchRequest;
}
