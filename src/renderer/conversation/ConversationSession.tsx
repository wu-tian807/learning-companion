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

type ConversationController = ReturnType<typeof useConversationController>;

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
  onPersistenceError,
  onBusyChange,
  mode = projectConversationMode,
  workspace,
  currentAssetSource,
  children,
}: {
  readonly open: boolean;
  readonly projectId: string;
  readonly historyStore: ConversationHistoryStore;
  readonly launchRequest?: ConversationLaunchRequest;
  readonly onLaunchConsumed?: (requestId: number) => void;
  readonly onPersistenceError?: (error: unknown) => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly mode?: ConversationModeDefinition;
  readonly workspace?: ConversationWorkspaceBinding;
  readonly currentAssetSource?: ActiveWorkbenchConversationContribution;
  readonly children: (controller: ConversationController) => ReactNode;
}) {
  const controller = useConversationController({
    open,
    projectId,
    historyStore,
    launchRequest,
    onLaunchConsumed,
    onPersistenceError,
    mode,
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

  useEffect(
    () => () => onBusyChangeRef.current?.(false),
    [],
  );

  return open ? children(controller) : null;
}
