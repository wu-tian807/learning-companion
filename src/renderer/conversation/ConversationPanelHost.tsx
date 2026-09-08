import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
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
  readonly controllerStore: ConversationPanelControllerStore;
  readonly controllerIdentity?: string;
}

const ConversationPanelSessionContext =
  createContext<ConversationPanelSessionValue | undefined>(undefined);

interface ConversationPanelControllerSnapshot {
  readonly identity?: string;
  readonly controller?: ConversationSessionController;
}

/**
 * Keeps the controller independent from the layout subtree that renders its
 * floating or right-rail Surface. The controller publishes after each state
 * update; the Project workbench never becomes its child.
 */
class ConversationPanelControllerStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: ConversationPanelControllerSnapshot = Object.freeze({});

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConversationPanelControllerSnapshot => this.snapshot;

  publish(identity: string, controller: ConversationSessionController): void {
    this.snapshot = Object.freeze({ identity, controller });
    for (const listener of [...this.listeners]) listener();
  }

  clear(identity: string): void {
    if (this.snapshot.identity !== identity) return;
    this.snapshot = Object.freeze({});
    for (const listener of [...this.listeners]) listener();
  }
}

function ConversationControllerBridge({
  controllerStore,
  controllerIdentity,
  controller,
}: {
  readonly controllerStore: ConversationPanelControllerStore;
  readonly controllerIdentity: string;
  readonly controller: ConversationSessionController;
}) {
  useLayoutEffect(() => {
    controllerStore.publish(controllerIdentity, controller);
  }, [controller, controllerIdentity, controllerStore]);
  useLayoutEffect(
    () => () => controllerStore.clear(controllerIdentity),
    [controllerIdentity, controllerStore],
  );
  return null;
}

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
  const controllerStore = useMemo(
    () => new ConversationPanelControllerStore(),
    [],
  );
  const settleLaunchRequest = useCallback(
    (requestId: number, error?: unknown) => {
      runtime.settleLaunchRequest(requestId, error);
    },
    [runtime],
  );
  const currentAssetSource =
    snapshot.active?.assetId === selectedAssetId ? snapshot.active : undefined;
  const activeMode = modeRegistry.resolve(snapshot.modeId, mode);
  const controllerIdentity = activeMode
    ? `${activeMode.id}:${snapshot.boundAssetId ?? ''}`
    : undefined;
  useEffect(() => {
    if (!activeMode && snapshot.launchRequest) {
      runtime.settleLaunchRequest(snapshot.launchRequest.id, new Error('此对话模式暂不可用。'));
    }
  }, [activeMode, runtime, snapshot.launchRequest]);

  return (
    <ConversationPanelSessionContext.Provider
      value={{ projectId, runtime, activeMode, controllerStore, controllerIdentity }}
    >
      {keepMounted || snapshot.panelOpen ? children : null}
      {activeMode && (keepMounted || snapshot.panelOpen) && controllerIdentity && (
        <ConversationSession
          key={controllerIdentity}
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
            <ConversationControllerBridge
              controllerStore={controllerStore}
              controllerIdentity={controllerIdentity}
              controller={controller}
            />
          )}
        </ConversationSession>
      )}
    </ConversationPanelSessionContext.Provider>
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
  if (!session) {
    throw new Error('ConversationPanelSurface 必须放在 ConversationPanelSessionHost 中。');
  }
  const controllerSnapshot = useSyncExternalStore(
    session.controllerStore.subscribe,
    session.controllerStore.getSnapshot,
    session.controllerStore.getSnapshot,
  );
  if (
    !session.activeMode ||
    !session.controllerIdentity ||
    controllerSnapshot.identity !== session.controllerIdentity ||
    !controllerSnapshot.controller
  ) {
    return <UnavailableConversationPanel runtime={session.runtime} onClose={onClose} />;
  }

  const { runtime, activeMode, projectId } = session;
  const { controller } = controllerSnapshot;
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
