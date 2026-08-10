/**
 * Cross-component state for the HTML AI conversation overlay.
 *
 * The overlay lives in the HTML workbench (it needs the workbench session's
 * executeCommand), but it renders inside the generation center panel. When
 * open, the generation center unmounts its panel and shows the conversation
 * instead; closing restores the panel. A tiny vanilla store bridges the two
 * without touching GenerationCenter's business logic.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface HtmlAiOverlayState {
  readonly open: boolean;
  openOverlay(): void;
  closeOverlay(): void;
}

export type HtmlAiOverlayStore = StoreApi<HtmlAiOverlayState>;

export function createHtmlAiOverlayStore(): HtmlAiOverlayStore {
  return createStore<HtmlAiOverlayState>((set) => ({
    open: false,
    openOverlay() {
      set({ open: true });
    },
    closeOverlay() {
      set({ open: false });
    },
  }));
}
