import { createStore, type StoreApi } from 'zustand/vanilla';

import type {
  WorkbenchInteractionContext,
  WorkbenchInteractionSnapshot,
  WorkbenchInvocationContext,
} from '../../../shared/workbench/interaction';

export interface WorkbenchRuntimeIdentity {
  readonly projectId: string;
  readonly assetId: string;
  readonly workbenchId: string;
  readonly sessionId: string;
}

export interface WorkbenchContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly invocation: WorkbenchInvocationContext;
}

export interface WorkbenchRuntimeState {
  readonly identity?: WorkbenchRuntimeIdentity;
  readonly interaction: WorkbenchInteractionSnapshot;
  readonly contextMenu?: WorkbenchContextMenuState;
  readonly busyActionIds: ReadonlySet<string>;
  activate(identity: WorkbenchRuntimeIdentity): void;
  deactivate(sessionId?: string): void;
  publishInteraction(
    context: WorkbenchInteractionContext,
  ): boolean;
  openContextMenu(state: WorkbenchContextMenuState): boolean;
  closeContextMenu(): void;
  setActionBusy(actionId: string, busy: boolean): void;
}

export type WorkbenchRuntimeStore = StoreApi<WorkbenchRuntimeState>;

export function createWorkbenchRuntimeStore(): WorkbenchRuntimeStore {
  return createStore<WorkbenchRuntimeState>((set, get) => ({
    interaction: {},
    busyActionIds: new Set<string>(),
    activate(identity) {
      set({
        identity,
        interaction: {},
        contextMenu: undefined,
        busyActionIds: new Set<string>(),
      });
    },
    deactivate(sessionId) {
      const identity = get().identity;

      if (sessionId && identity?.sessionId !== sessionId) {
        return;
      }

      set({
        identity: undefined,
        interaction: {},
        contextMenu: undefined,
        busyActionIds: new Set<string>(),
      });
    },
    publishInteraction(context) {
      const identity = get().identity;

      if (
        !identity ||
        identity.projectId !== context.projectId ||
        identity.assetId !== context.assetId ||
        identity.workbenchId !== context.workbenchId ||
        identity.sessionId !== context.sessionId
      ) {
        return false;
      }

      set({
        interaction: {
          target: context.target,
          selection: context.selection,
        },
      });
      return true;
    },
    openContextMenu(contextMenu) {
      const identity = get().identity;

      if (
        !identity ||
        identity.sessionId !== contextMenu.invocation.sessionId ||
        identity.assetId !== contextMenu.invocation.assetId
      ) {
        return false;
      }

      set({ contextMenu });
      return true;
    },
    closeContextMenu() {
      set({ contextMenu: undefined });
    },
    setActionBusy(actionId, busy) {
      const busyActionIds = new Set(get().busyActionIds);

      if (busy) {
        busyActionIds.add(actionId);
      } else {
        busyActionIds.delete(actionId);
      }
      set({ busyActionIds });
    },
  }));
}
