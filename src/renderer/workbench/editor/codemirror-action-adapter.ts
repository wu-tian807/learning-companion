import {
  redo,
  redoDepth,
  selectAll,
  undo,
  undoDepth,
} from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';

import type { ContentAnchorTarget } from '../../../shared/workbench/anchor';
import type { WorkbenchInteractionSnapshot } from '../../../shared/workbench/interaction';
import type { WorkbenchSelectionSnapshot } from '../../../shared/workbench/selection';
import type { WorkbenchContextMenuWheelEvent } from '../runtime/workbench-runtime-store';
import type {
  EditorActionAdapter,
  EditorActionState,
  EditorContextMenuCapture,
} from './editor-action-adapter';

export interface CodeMirrorSelectionRange {
  readonly from: number;
  readonly to: number;
}

export interface CodeMirrorSelectionTargetInput {
  readonly source: string;
  readonly ranges: readonly CodeMirrorSelectionRange[];
  readonly text: string;
}

export interface CodeMirrorEditorActionAdapterOptions {
  readonly getView: () => EditorView | undefined;
  readonly isEditable: () => boolean;
  readonly createTarget: (
    input: CodeMirrorSelectionTargetInput,
  ) => ContentAnchorTarget;
  readonly clipboard?: {
    readonly readText: () => Promise<string>;
    readonly writeText: (text: string) => Promise<void>;
  };
}

function defaultClipboard() {
  return {
    async readText(): Promise<string> {
      if (!navigator.clipboard?.readText) {
        throw new Error('当前环境不支持读取剪贴板');
      }
      return navigator.clipboard.readText();
    },
    async writeText(text: string): Promise<void> {
      if (!navigator.clipboard?.writeText) {
        throw new Error('当前环境不支持写入剪贴板');
      }
      await navigator.clipboard.writeText(text);
    },
  };
}

export class CodeMirrorEditorActionAdapter
  implements EditorActionAdapter
{
  private readonly clipboard: {
    readonly readText: () => Promise<string>;
    readonly writeText: (text: string) => Promise<void>;
  };
  private frozenRanges: readonly CodeMirrorSelectionRange[] = [];

  constructor(
    private readonly options: CodeMirrorEditorActionAdapterOptions,
  ) {
    this.clipboard = options.clipboard ?? defaultClipboard();
  }

  getState(): EditorActionState {
    const view = this.options.getView();
    const editable = this.options.isEditable();
    const hasSelection = this.frozenRanges.some(
      (range) => range.from !== range.to,
    );

    return {
      canUndo:
        editable &&
        view !== undefined &&
        undoDepth(view.state) > 0,
      canRedo:
        editable &&
        view !== undefined &&
        redoDepth(view.state) > 0,
      canCut: editable && hasSelection,
      canCopy: hasSelection,
      canPaste: editable && view !== undefined,
      canSelectAll: view !== undefined,
      canFind: view !== undefined,
    };
  }

  captureInteraction(): WorkbenchInteractionSnapshot {
    const view = this.options.getView();

    if (!view) {
      return {};
    }

    const ranges = view.state.selection.ranges
      .filter((range) => !range.empty)
      .map((range) => ({
        from: range.from,
        to: range.to,
      }));

    return this.createInteraction(view.state.doc.toString(), ranges);
  }

  captureContextMenu(
    clientX: number,
    clientY: number,
  ): EditorContextMenuCapture {
    const view = this.requireView();
    const clickedPosition = view.posAtCoords({
      x: clientX,
      y: clientY,
    });

    if (clickedPosition !== null) {
      const insideSelection = view.state.selection.ranges.some(
        (range) =>
          !range.empty &&
          clickedPosition >= range.from &&
          clickedPosition <= range.to,
      );

      if (!insideSelection) {
        view.dispatch({
          selection: {
            anchor: clickedPosition,
            head: clickedPosition,
          },
        });
      }
    }

    this.frozenRanges = view.state.selection.ranges.map((range) => ({
      from: range.from,
      to: range.to,
    }));

    const source = view.state.doc.toString();
    const nonEmptyRanges = this.frozenRanges.filter(
      (range) => range.from !== range.to,
    );
    const anchorRanges =
      nonEmptyRanges.length > 0
        ? nonEmptyRanges
        : this.frozenRanges.slice(0, 1);

    return {
      interaction: this.createInteraction(
        source,
        anchorRanges,
        true,
      ),
      onWheel: (event) => this.scrollByWheel(event),
    };
  }

  undo(): void {
    const view = this.requireView();
    undo(view);
  }

  redo(): void {
    const view = this.requireView();
    redo(view);
  }

  async cut(): Promise<void> {
    this.requireEditable();
    const view = this.requireView();
    const text = this.selectedText(view);

    if (!text) {
      return;
    }

    await this.clipboard.writeText(text);
    this.replaceFrozenRanges(view, '', true);
  }

  async copy(): Promise<void> {
    const view = this.requireView();
    const text = this.selectedText(view);

    if (text) {
      await this.clipboard.writeText(text);
    }
  }

  async paste(): Promise<void> {
    this.requireEditable();
    const view = this.requireView();
    const text = await this.clipboard.readText();
    this.replaceFrozenRanges(view, text, false);
  }

  selectAll(): void {
    selectAll(this.requireView());
  }

  find(): void {
    if (!openSearchPanel(this.requireView())) {
      throw new Error('当前编辑器不支持搜索');
    }
  }

  private requireView(): EditorView {
    const view = this.options.getView();

    if (!view) {
      throw new Error('文本编辑器尚未准备完成');
    }
    return view;
  }

  private requireEditable(): void {
    if (!this.options.isEditable()) {
      throw new Error('当前文本编辑器不可修改');
    }
  }

  private selectedText(view: EditorView): string {
    const source = view.state.doc.toString();
    return this.frozenRanges
      .filter((range) => range.from !== range.to)
      .map((range) => source.slice(range.from, range.to))
      .join('\n');
  }

  private createInteraction(
    source: string,
    ranges: readonly CodeMirrorSelectionRange[],
    includeCollapsedTarget = false,
  ): WorkbenchInteractionSnapshot {
    const selectedRanges = ranges.filter(
      (range) => range.from !== range.to,
    );

    if (selectedRanges.length === 0 && !includeCollapsedTarget) {
      return {};
    }

    const targetRanges =
      selectedRanges.length > 0 ? selectedRanges : ranges.slice(0, 1);
    const text = selectedRanges
      .map((range) => source.slice(range.from, range.to))
      .join('\n');
    const target = this.options.createTarget({
      source,
      ranges: targetRanges,
      text,
    });
    const selection: WorkbenchSelectionSnapshot | undefined = text
      ? { text, target }
      : undefined;

    return { target, selection };
  }

  private replaceFrozenRanges(
    view: EditorView,
    replacement: string,
    requireSelection: boolean,
  ): void {
    const ranges = requireSelection
      ? this.frozenRanges.filter((range) => range.from !== range.to)
      : this.frozenRanges;

    if (ranges.length === 0) {
      return;
    }

    view.dispatch({
      changes: ranges.map((range) => ({
        from: range.from,
        to: range.to,
        insert: replacement,
      })),
    });
  }

  private scrollByWheel(event: WorkbenchContextMenuWheelEvent): void {
    const scrollDom = this.options.getView()?.scrollDOM;

    if (!scrollDom) {
      return;
    }

    const scale =
      event.deltaMode === 1
        ? 24
        : event.deltaMode === 2
          ? scrollDom.clientHeight
          : 1;
    scrollDom.scrollBy({
      left: event.deltaX * scale,
      top: event.deltaY * scale,
    });
  }
}
