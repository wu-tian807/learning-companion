/**
 * Cross-component state for a Workbench panel contribution.
 *
 * A Workbench (e.g. HTML chat) can contribute a panel that renders inside
 * the generic host slot. When the panel is open, the host unmounts its own
 * panel and shows the contribution instead; closing restores the host panel.
 * A tiny vanilla store bridges the two without touching the host's business
 * logic or knowing which Workbench contributed the panel.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface WorkbenchPanelState {
  readonly open: boolean;
  openPanel(): void;
  closePanel(): void;
}

export type WorkbenchPanelStore = StoreApi<WorkbenchPanelState>;

export function createWorkbenchPanelStore(): WorkbenchPanelStore {
  return createStore<WorkbenchPanelState>((set) => ({
    open: false,
    openPanel() {
      set({ open: true });
    },
    closePanel() {
      set({ open: false });
    },
  }));
}
