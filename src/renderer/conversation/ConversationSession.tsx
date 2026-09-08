import { useEffect, useRef, type ReactNode } from 'react';

import type {
  ActiveWorkbenchConversationContribution,
  ConversationHistoryStore,
  ConversationLaunchRequest,
  ConversationWorkspaceBinding,
} from './conversation-contracts';
import { useConversationController } from './conversation-controller';
import type { ConversationModeDefinition } from './conversation-mode';
import { projectConversationMode } from './project-conversation-mode';

export type ConversationSessionController = ReturnType<typeof useConversationController>;

/**
 * Headless conversation lifecycle shared by side panels, dialogs and embedded
 * generation experiences. The caller owns the visual surface.
 */
export function ConversationSession({
  open,
  projectId,
  historyStore,
  launchRequest,
  onLaunchConsumed,
  onLaunchSettled,
  onPersistenceError,
  onBusyChange,
  onConversationIdentityChange,
  mode = projectConversationMode,
  boundAssetId,
  workspace,
  currentAssetSource,
  keepMounted = false,
  children,
}: {
  readonly open: boolean;
  readonly projectId: string;
  readonly historyStore: ConversationHistoryStore;
  readonly launchRequest?: ConversationLaunchRequest;
  readonly onLaunchConsumed?: (requestId: number) => void;
  readonly onLaunchSettled?: (requestId: number, error?: unknown) => void;
  readonly onPersistenceError?: (error: unknown) => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onConversationIdentityChange?: (conversationId: string) => void;
  readonly mode?: ConversationModeDefinition;
  readonly boundAssetId?: string;
  readonly workspace?: ConversationWorkspaceBinding;
  readonly currentAssetSource?: ActiveWorkbenchConversationContribution;
  /** Keep the controller alive while its visual surface moves between layouts. */
  readonly keepMounted?: boolean;
  readonly children: (controller: ConversationSessionController) => ReactNode;
}) {
  const controller = useConversationController({
    open,
    projectId,
    historyStore,
    launchRequest,
    onLaunchConsumed,
    onLaunchSettled,
    onPersistenceError,
    mode,
    boundAssetId,
    workspace,
    currentAssetSource,
  });
  const onBusyChangeRef = useRef(onBusyChange);

  useEffect(() => {
    onBusyChangeRef.current = onBusyChange;
  }, [onBusyChange]);

  useEffect(() => {
    onBusyChangeRef.current?.(controller.state.busy);
  }, [controller.state.busy]);

  useEffect(() => {
    if (open) {
      onConversationIdentityChange?.(controller.state.conversation.id);
    }
  }, [controller.state.conversation.id, onConversationIdentityChange, open]);

  useEffect(() => () => onBusyChangeRef.current?.(false), []);

  return open || keepMounted ? children(controller) : null;
}
