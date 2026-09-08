import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from 'react';

import { ConversationPanel } from './ConversationPanel';
import {
  ConversationSession,
  type ConversationSessionController,
} from './ConversationSession';
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
import type { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

interface ConversationPanelSessionValue {
  readonly projectId: string;
  readonly runtime: WorkbenchConversationRuntime;
  readonly activeMode?: ConversationModeDefinition;
  readonly controller?: ConversationSessionController;
}

const ConversationPanelSessionContext =
  createContext<ConversationPanelSessionValue | undefined>(undefined);

interface ConversationPanelSessionHostProps {
  readonly projectId: string;
  readonly historyStore: ConversationHistoryStore;
  readonly mode?: ConversationModeDefinition;
  readonly modeRegistry?: ConversationModeRegistry;
  readonly workspace?: ConversationWorkspaceBinding;
  readonly selectedAssetId?: string;
  /** Render children even when closed so the controller can outlive a layout move. */
  readonly keepMounted?: boolean;
  readonly children: ReactNode;
}

interface ConversationPanelSurfaceProps {
  readonly onClose?: () => void;
  readonly onSelectAsset: (assetId: string) => Promise<void> | void;
  readonly onOpenSettings?: () => void;
  readonly onError?: (message: string) => void;
  readonly compact?: boolean;
  readonly onExpand?: () => void;
}

function UnavailableConversationPanel({
  runtime,
  onClose,
}: Pick<ConversationPanelSessionValue, 'runtime'> & Pick<ConversationPanelSurfaceProps, 'onClose'>) {
  return (
    <div role="alert" className="p-4 text-sm text-slate-400">
      <p>此对话模式暂不可用，请重新打开对应资料。</p>
      <button
        type="button"
        onClick={() => {
          if (onClose) onClose();
          else runtime.close();
        }}
      >
        关闭
      </button>
    </div>
  );
}

/**
 * Owns one conversation controller independently of the place where its panel
 * is rendered. ProjectPage uses it to move an open chat between the floating
 * surface and the existing right rail without rebuilding the chat state.
 */
export function ConversationPanelSessionHost({
  projectId,
  historyStore,
  mode = projectConversationMode,
  modeRegistry = defaultConversationModeRegistry,
  workspace,
  selectedAssetId,
  keepMounted = false,
  children,
}: ConversationPanelSessionHostProps) {
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
    return (
      <ConversationPanelSessionContext.Provider value={{ projectId, runtime }}>
        {children}
      </ConversationPanelSessionContext.Provider>
    );
  }

  return (
    <ConversationSession
      key={`${activeMode.id}:${snapshot.boundAssetId ?? ''}:${snapshot.panelOpen ? 'open' : 'closed'}`}
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
      keepMounted={keepMounted}
    >
      {(controller) => (
        <ConversationPanelSessionContext.Provider
          value={{ projectId, runtime, activeMode, controller }}
        >
          {children}
        </ConversationPanelSessionContext.Provider>
      )}
    </ConversationSession>
  );
}

export function ConversationPanelSurface({
  onClose,
  onSelectAsset,
  onOpenSettings,
  onError,
  compact = false,
  onExpand,
}: ConversationPanelSurfaceProps) {
  const session = useContext(ConversationPanelSessionContext);
  if (!session || !session.activeMode || !session.controller) {
    if (!session) {
      throw new Error('ConversationPanelSurface 必须放在 ConversationPanelSessionHost 中。');
    }
    return <UnavailableConversationPanel runtime={session.runtime} onClose={onClose} />;
  }

  const { controller, runtime, activeMode, projectId } = session;
  return (
    <ConversationPanel
      state={controller.state}
      actions={controller.actions}
      projectId={projectId}
      resolveContextContribution={(source) => runtime.resolveContribution(source)}
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
  );
}

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
}: Omit<ConversationPanelSessionHostProps, 'children' | 'keepMounted'> & ConversationPanelSurfaceProps) {
  return (
    <ConversationPanelSessionHost
      projectId={projectId}
      historyStore={historyStore}
      mode={mode}
      modeRegistry={modeRegistry}
      workspace={workspace}
      selectedAssetId={selectedAssetId}
    >
      <ConversationPanelSurface
        onClose={onClose}
        onSelectAsset={onSelectAsset}
        onOpenSettings={onOpenSettings}
        onError={onError}
        compact={compact}
        onExpand={onExpand}
      />
    </ConversationPanelSessionHost>
  );
}
