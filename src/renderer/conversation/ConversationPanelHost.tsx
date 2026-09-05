import { ConversationPanel } from './ConversationPanel';
import { ConversationSession } from './ConversationSession';
import type {
  ConversationHistoryStore,
  ConversationWorkspaceBinding,
} from './conversation-contracts';
import type { ConversationModeDefinition } from './conversation-mode';
import { projectConversationMode } from './project-conversation-mode';
import {
  defaultConversationModeRegistry,
  type ConversationModeRegistry,
} from './conversation-mode-registry';
import {
  useWorkbenchConversationRuntime,
  useWorkbenchConversationSnapshot,
} from './workbench-conversation-context';

export function ConversationPanelHost({
  projectId,
  historyStore,
  onClose,
  onSelectAsset,
  onOpenSettings,
  onError,
  mode = projectConversationMode,
  modeRegistry = defaultConversationModeRegistry,
  workspace,
  selectedAssetId,
}: {
  readonly projectId: string;
  readonly historyStore: ConversationHistoryStore;
  readonly onClose?: () => void;
  readonly onSelectAsset: (assetId: string) => Promise<void> | void;
  readonly onOpenSettings?: () => void;
  readonly onError?: (message: string) => void;
  readonly mode?: ConversationModeDefinition;
  readonly modeRegistry?: ConversationModeRegistry;
  readonly workspace?: ConversationWorkspaceBinding;
  readonly selectedAssetId?: string;
}) {
  const runtime = useWorkbenchConversationRuntime();
  const snapshot = useWorkbenchConversationSnapshot(runtime);
  const currentAssetSource =
    snapshot.active?.assetId === selectedAssetId
      ? snapshot.active
      : undefined;
  const activeMode = modeRegistry.resolve(snapshot.modeId, mode);

  return (
    <ConversationSession
      key={`${activeMode.id}:${snapshot.boundAssetId ?? ''}`}
      projectId={projectId}
      historyStore={historyStore}
      open={snapshot.panelOpen}
      launchRequest={snapshot.launchRequest}
      onLaunchConsumed={(requestId) =>
        runtime.consumeLaunchRequest(requestId)
      }
      mode={activeMode}
      boundAssetId={snapshot.boundAssetId}
      workspace={workspace}
      currentAssetSource={currentAssetSource}
      onPersistenceError={(error) => {
        console.error('[conversation] persistence failed', error);
      }}
      onBusyChange={(busy) => runtime.setBusy(busy)}
      onConversationIdentityChange={(conversationId) =>
        runtime.setConversationIdentity(conversationId)
      }
    >
      {(controller) => (
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
            if (onClose) onClose();
            else runtime.close();
          }}
          onOpenSettings={onOpenSettings}
          onError={onError}
          presentation={activeMode.presentation}
        />
      )}
    </ConversationSession>
  );
}
