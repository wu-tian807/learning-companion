import type {
  WorkbenchInteractionSnapshot,
} from '../../../shared/workbench/interaction';
import type { WorkbenchContextMenuWheelEvent } from '../runtime/workbench-runtime-store';

export interface EditorActionState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canCut: boolean;
  readonly canCopy: boolean;
  readonly canPaste: boolean;
  readonly canSelectAll: boolean;
  readonly canFind: boolean;
}

export interface EditorContextMenuCapture {
  readonly interaction: WorkbenchInteractionSnapshot;
  readonly onWheel?: (event: WorkbenchContextMenuWheelEvent) => void;
}

export interface EditorActionAdapter {
  getState(): EditorActionState;
  captureContextMenu(
    clientX: number,
    clientY: number,
  ): EditorContextMenuCapture;
  undo(): Promise<void> | void;
  redo(): Promise<void> | void;
  cut(): Promise<void> | void;
  copy(): Promise<void> | void;
  paste(): Promise<void> | void;
  selectAll(): Promise<void> | void;
  find(): Promise<void> | void;
}
