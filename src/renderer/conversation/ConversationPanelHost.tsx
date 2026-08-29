import { useEffect } from 'react';

import { useConversationController } from './conversation-controller';
import { ConversationPanel } from './ConversationPanel';
import type {
  ConversationLaunchRequest,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import {
  useWorkbenchConversationRuntime,
  useWorkbenchConversationSnapshot,
} from './workbench-conversation-context';
import type { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

export function ConversationPanelHost({
  projectId,
  assetId,
  onOpenSettings,
  onError,
}: {
  readonly projectId: string;
  readonly assetId: string | undefined;
  readonly onOpenSettings?: () => void;
  readonly onError?: (message: string) => void;
}) {
  const runtime = useWorkbenchConversationRuntime();
  const snapshot = useWorkbenchConversationSnapshot(runtime);
  const contribution = snapshot.active?.contribution;

  if (!assetId || !contribution) return null;

  return (
    <ActiveConversationPanel
      key={`${projectId}:${assetId}:${contribution.id}`}
      projectId={projectId}
      assetId={assetId}
      contribution={contribution}
      ownerId={snapshot.active.ownerId}
      runtime={runtime}
      open={snapshot.panelOpen}
      launchRequest={snapshot.launchRequest}
      onLaunchConsumed={(requestId) => runtime.consumeLaunchRequest(requestId)}
      onClose={() => runtime.close()}
      onOpenSettings={onOpenSettings}
      onError={onError}
    />
  );
}

function ActiveConversationPanel({
  projectId,
  assetId,
  contribution,
  ownerId,
  runtime,
  open,
  launchRequest,
  onLaunchConsumed,
  onClose,
  onOpenSettings,
  onError,
}: {
  readonly projectId: string;
  readonly assetId: string;
  readonly contribution: WorkbenchConversationContribution;
  readonly ownerId: string;
  readonly runtime: WorkbenchConversationRuntime;
  readonly open: boolean;
  readonly launchRequest: ConversationLaunchRequest | undefined;
  readonly onLaunchConsumed: (requestId: number) => void;
  readonly onClose: () => void;
  readonly onOpenSettings?: () => void;
  readonly onError?: (message: string) => void;
}) {
  const controller = useConversationController({
    open,
    projectId,
    assetId,
    contribution,
    initialConversation: runtime.getCurrentConversation({
      projectId,
      assetId,
      contributionId: contribution.id,
    }),
    onConversationChange(conversation) {
      runtime.setCurrentConversation(
        { projectId, assetId, contributionId: contribution.id },
        conversation,
      );
    },
    launchRequest,
    onLaunchConsumed,
    onPersistenceError(error) {
      console.error('[conversation] persistence failed', error);
    },
  });

  useEffect(() => {
    runtime.setBusy(ownerId, controller.state.busy);
    return () => runtime.setBusy(ownerId, false);
  }, [controller.state.busy, ownerId, runtime]);

  useEffect(() => {
    runtime.setCurrentConversation(
      { projectId, assetId, contributionId: contribution.id },
      controller.state.conversation,
    );
  }, [
    assetId,
    contribution.id,
    controller.state.conversation,
    projectId,
    runtime,
  ]);

  if (!open) return null;

  return (
    <ConversationPanel
      state={controller.state}
      actions={controller.actions}
      contribution={contribution}
      projectId={projectId}
      assetId={assetId}
      onClose={() => {
        if (controller.state.pendingContext !== undefined) {
          controller.actions.setPendingContext(undefined);
        } else {
          contribution.onContextReleased?.(undefined);
        }
        onClose();
      }}
      onOpenSettings={onOpenSettings}
      onError={onError}
    />
  );
}
