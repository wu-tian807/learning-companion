import type { JsonValue } from '../../shared/workbench/protocol';

export type ConversationRole = 'user' | 'assistant';

export interface ConversationReanswerBackup {
  readonly text: string;
  readonly generationTaskId?: string;
  readonly modelInfo?: string;
  readonly stopped?: true;
}

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
  /** Persisted until a replacement answer completes so failure/restart can restore it. */
  readonly reanswerBackup?: ConversationReanswerBackup;
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

export interface ConversationAnswerActionPresentation {
  readonly label: string;
  readonly selectionLabel: string;
  readonly successMessage: string;
  readonly failureMessage: string;
}

export interface ConversationAnswerAction
  extends ConversationAnswerActionPresentation {
  execute(input: ConversationAnswerActionInput): Promise<void> | void;
}

/**
 * Renderer contribution supplied by one active Workbench.
 *
 * The shared conversation layer owns the TaskDefinition, Agent Session,
 * Provider call, task lifecycle and result projection. The contribution only
 * declares Renderer-side media context and optional UI actions. Main-side
 * media semantics live in the matching context provider.
 */
export interface WorkbenchConversationContribution {
  readonly id: string;
  readonly workbenchId: string;
  /** Opaque Workbench-owned key that partitions in-memory conversation state. */
  readonly conversationPartitionKey?: string;
  /** Main-side provider that turns the opaque Workbench context into Agent input. */
  readonly contextProviderId: string;
  /** Copies the current Asset into the conversation Workspace when true. */
  readonly includeSourceAssetReference?: boolean;
  readonly initialContextRequired?: boolean;
  readonly initialContextRequiredMessage?: string;
  readonly title: string;
  readonly emptyLabel: string;
  readonly inputPlaceholder?: string;
  readonly historyStore: ConversationHistoryStore;
  isContext?(context: JsonValue): boolean;
  shouldCommitAnswer?(input: ConversationTaskInput): boolean;
  describeContext?(context: JsonValue): ConversationContextPresentation;
  revealContext?(context: JsonValue): Promise<void> | void;
  /** Clears Workbench-owned transient context UI after send, discard, restore or close. */
  onContextReleased?(context: JsonValue | undefined): void;
  /** Optional answer operation whose presentation and media behavior are Workbench-owned. */
  readonly answerAction?: ConversationAnswerAction;
}

export interface ConversationLaunchRequest {
  readonly id: number;
  /** Only set when the user explicitly restores a persisted UI history entry. */
  readonly conversationId?: string;
  readonly fallbackToNewConversation?: boolean;
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
