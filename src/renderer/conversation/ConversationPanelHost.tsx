import { useCallback, useEffect } from 'react';

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
  compact = false,
  onExpand,
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
  readonly compact?: boolean;
  readonly onExpand?: () => void;
  readonly mode?: ConversationModeDefinition;
  readonly modeRegistry?: ConversationModeRegistry;
  readonly workspace?: ConversationWorkspaceBinding;
  readonly selectedAssetId?: string;
}) {
  const runtime = useWorkbenchConversationRuntime();
  const snapshot = useWorkbenchConversationSnapshot(runtime);
  const settleLaunchRequest = useCallback(
    (requestId: number, error?: unknown) => {
      runtime.settleLaunchRequest(requestId, error);
    },
    [runtime],
  );
  const currentAssetSource =
    snapshot.active?.assetId === selectedAssetId ? snapshot.active : undefined;
  const activeMode = modeRegistry.resolve(snapshot.modeId, mode);
  useEffect(() => {
    if (!activeMode && snapshot.launchRequest) {
      runtime.settleLaunchRequest(snapshot.launchRequest.id, new Error('此对话模式暂不可用。'));
    }
  }, [activeMode, runtime, snapshot.launchRequest]);

  if (!activeMode) {
    return <div role="alert" className="p-4 text-sm text-slate-400">
      <p>此对话模式暂不可用，请重新打开对应资料。</p>
      <button type="button" onClick={() => { runtime.close(); onClose?.(); }}>关闭</button>
    </div>;
  }

  return (
    <ConversationSession
      key={`${activeMode.id}:${snapshot.boundAssetId ?? ''}`}
      projectId={projectId}
      historyStore={historyStore}
      open={snapshot.panelOpen}
      launchRequest={snapshot.launchRequest}
      onLaunchConsumed={(requestId) => runtime.consumeLaunchRequest(requestId)}
      onLaunchSettled={settleLaunchRequest}
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
          onStartNew={() => runtime.open({ fallbackToNewConversation: true })}
          onClose={() => {
            controller.actions.setPendingContext(undefined);
            if (onClose) onClose();
            else runtime.close();
          }}
          onOpenSettings={onOpenSettings}
          onError={onError}
          presentation={activeMode.presentation}
          compact={compact}
          onExpand={onExpand}
        />
      )}
    </ConversationSession>
  );
}
