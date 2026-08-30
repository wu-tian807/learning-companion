import { useEffect } from 'react';

import { useConversationController } from './conversation-controller';
import { ConversationPanel } from './ConversationPanel';
import type {
  ConversationHistoryStore,
  ConversationLaunchRequest,
} from './conversation-contracts';
import {
  useWorkbenchConversationRuntime,
  useWorkbenchConversationSnapshot,
} from './workbench-conversation-context';
import type { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

export function ConversationPanelHost({
  projectId,
  historyStore,
  onClose,
  onSelectAsset,
  onOpenSettings,
  onError,
}: {
  readonly projectId: string;
  readonly historyStore: ConversationHistoryStore;
  readonly onClose?: () => void;
  readonly onSelectAsset: (assetId: string) => Promise<void> | void;
  readonly onOpenSettings?: () => void;
  readonly onError?: (message: string) => void;
}) {
  const runtime = useWorkbenchConversationRuntime();
  const snapshot = useWorkbenchConversationSnapshot(runtime);

  return (
    <ActiveConversationPanel
      projectId={projectId}
      historyStore={historyStore}
      runtime={runtime}
      open={snapshot.panelOpen}
      launchRequest={snapshot.launchRequest}
      onLaunchConsumed={(requestId) =>
        runtime.consumeLaunchRequest(requestId)
      }
      onClose={() => {
        if (onClose) onClose();
        else runtime.close();
      }}
      onSelectAsset={onSelectAsset}
      onOpenSettings={onOpenSettings}
      onError={onError}
    />
  );
}

function ActiveConversationPanel({
  projectId,
  historyStore,
  runtime,
  open,
  launchRequest,
  onLaunchConsumed,
  onClose,
  onSelectAsset,
  onOpenSettings,
  onError,
}: {
  readonly projectId: string;
  readonly historyStore: ConversationHistoryStore;
  readonly runtime: WorkbenchConversationRuntime;
  readonly open: boolean;
  readonly launchRequest: ConversationLaunchRequest | undefined;
  readonly onLaunchConsumed: (requestId: number) => void;
  readonly onClose: () => void;
  readonly onSelectAsset: (assetId: string) => Promise<void> | void;
  readonly onOpenSettings?: () => void;
  readonly onError?: (message: string) => void;
}) {
  const controller = useConversationController({
    open,
    projectId,
    historyStore,
    launchRequest,
    onLaunchConsumed,
    onPersistenceError(error) {
      console.error('[conversation] persistence failed', error);
    },
  });

  useEffect(() => {
    runtime.setBusy(controller.state.busy);
    return () => runtime.setBusy(false);
  }, [controller.state.busy, runtime]);

  if (!open) return null;

  return (
    <ConversationPanel
      state={controller.state}
      actions={controller.actions}
      projectId={projectId}
      resolveContextContribution={(source) =>
        runtime.resolveContribution(source)
      }
      onRevealContext={(source, context) =>
        runtime.revealContext(source, context, onSelectAsset)
      }
      onStartNew={() =>
        runtime.open({ fallbackToNewConversation: true })
      }
      onClose={() => {
        controller.actions.setPendingContext(undefined);
        onClose();
      }}
      onOpenSettings={onOpenSettings}
      onError={onError}
    />
  );
}
