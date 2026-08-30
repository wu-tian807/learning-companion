import type {
  ConversationMessageContextSource,
  ConversationMessageRecord,
  ConversationRecord,
} from '../../shared/project-conversations';
import type { JsonValue } from '../../shared/workbench/protocol';

export type {
  ConversationMessageRecord,
  ConversationMessageContextSource,
  ConversationReanswerBackup,
  ConversationRecord,
  ConversationRole,
} from '../../shared/project-conversations';

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
  readonly assetId?: string;
  readonly conversationId: string;
  readonly question: string;
  readonly context?: JsonValue;
  readonly contextSource?: ConversationMessageContextSource;
  readonly generateTitle: boolean;
}

export interface ConversationAnswerActionInput {
  readonly projectId: string;
  readonly assetId?: string;
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
 * Optional Renderer-side context supplied by a Workbench for one message.
 *
 * Project Conversation owns chat availability, presentation, history, sending,
 * the Agent Session and task lifecycle. A Workbench can only describe and
 * operate on its media-specific context. Main-side media semantics live in the
 * matching context provider.
 */
export interface WorkbenchConversationContribution {
  readonly id: string;
  readonly workbenchId: string;
  /** Main-side provider that turns the opaque Workbench context into Agent input. */
  readonly contextProviderId: string;
  /** Declares whether this Workbench context needs only the Asset id or a materialized source copy. */
  readonly sourceAssetMode?: 'identity' | 'reference';
  readonly contextRequired?: boolean;
  readonly contextRequiredMessage?: string;
  isContext?(context: JsonValue): boolean;
  shouldCommitAnswer?(input: ConversationTaskInput): boolean;
  describeContext?(
    context: JsonValue | undefined,
  ): ConversationContextPresentation;
  revealContext?(context: JsonValue): Promise<void> | void;
  /** Clears Workbench-owned transient context UI after send, discard, restore or close. */
  onContextReleased?(context: JsonValue | undefined): void;
  /** Optional answer operation whose presentation and media behavior are Workbench-owned. */
  readonly answerAction?: ConversationAnswerAction;
}

export interface ConversationLaunchRequest {
  readonly id: number;
  readonly conversationId?: string;
  readonly fallbackToNewConversation?: boolean;
  readonly clearContext?: boolean;
  readonly contextSource?: ActiveWorkbenchConversationContribution;
  readonly context?: JsonValue;
  readonly question?: string;
  readonly submit?: boolean;
}

export interface ActiveWorkbenchConversationContribution {
  readonly ownerId: string;
  readonly assetId: string;
  readonly contribution: WorkbenchConversationContribution;
}

export interface ConversationContextAttachment
  extends ActiveWorkbenchConversationContribution {
  readonly context?: JsonValue;
}

export interface WorkbenchConversationRuntimeSnapshot {
  readonly contextSource?: ActiveWorkbenchConversationContribution;
  readonly panelOpen: boolean;
  readonly busy: boolean;
  readonly registryRevision: number;
  readonly launchRequest?: ConversationLaunchRequest;
}
