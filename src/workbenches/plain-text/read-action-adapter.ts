import type { WorkbenchInteractionSnapshot } from '../../shared/workbench/interaction';
import {
  interactionFromTextSelection,
  type WorkbenchSelectionSnapshot,
} from '../../shared/workbench/selection';
import { createTextRangeTarget } from '../../shared/workbench/text-range-anchor';
import type { WorkbenchContextMenuWheelEvent } from '../../renderer/workbench/runtime/workbench-runtime-store';
import type {
  EditorActionAdapter,
  EditorActionState,
  EditorContextMenuCapture,
} from '../../renderer/workbench/editor/editor-action-adapter';
import {
  PLAIN_TEXT_RANGE_ANCHOR_TYPE,
} from './shared';

export interface PlainTextReadActionAdapterOptions {
  readonly getContainer: () => HTMLElement | null | undefined;
  readonly getSource: () => string;
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

function createCaretRange(
  ownerDocument: Document,
  x: number,
  y: number,
): Range | undefined {
  const position = ownerDocument.caretPositionFromPoint?.(x, y);

  if (position) {
    const range = ownerDocument.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }

  const documentWithLegacyCaret = ownerDocument as Document & {
    caretRangeFromPoint?(pointX: number, pointY: number): Range | null;
  };

  return (
    documentWithLegacyCaret.caretRangeFromPoint?.(x, y) ??
    undefined
  );
}

function rangeBelongsToElement(
  range: Range,
  element: HTMLElement,
): boolean {
  return (
    element.contains(range.startContainer) &&
    element.contains(range.endContainer)
  );
}

function rangeContainsPoint(
  range: Range,
  point: Range,
): boolean {
  try {
    return range.isPointInRange(
      point.startContainer,
      point.startOffset,
    );
  } catch {
    return false;
  }
}

export class PlainTextReadActionAdapter
  implements EditorActionAdapter
{
  private readonly clipboard: {
    readonly readText: () => Promise<string>;
    readonly writeText: (text: string) => Promise<void>;
  };
  private frozenRange: Range | undefined;
  private frozenText = '';

  constructor(
    private readonly options: PlainTextReadActionAdapterOptions,
  ) {
    this.clipboard = options.clipboard ?? defaultClipboard();
  }

  getState(): EditorActionState {
    const ready = Boolean(this.options.getContainer());
    const hasSelection =
      ready &&
      this.frozenRange !== undefined &&
      !this.frozenRange.collapsed;

    return {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: hasSelection,
      canPaste: false,
      canSelectAll: ready,
      canFind: false,
    };
  }

  captureInteraction(): WorkbenchInteractionSnapshot {
    const element = this.options.getContainer();
    const selection =
      element?.ownerDocument.defaultView?.getSelection();

    if (!element || !selection || selection.rangeCount === 0) {
      return { inputs: [] };
    }

    const range = selection.getRangeAt(0);

    if (
      range.collapsed ||
      !rangeBelongsToElement(range, element)
    ) {
      return { inputs: [] };
    }

    return this.createInteraction(range.toString(), true);
  }

  captureContextMenu(
    clientX: number,
    clientY: number,
  ): EditorContextMenuCapture {
    const element = this.requireContainer();
    const ownerDocument = element.ownerDocument;
    const selection = ownerDocument.defaultView?.getSelection();
    const currentRange =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0)
        : undefined;
    const pointRange = createCaretRange(
      ownerDocument,
      clientX,
      clientY,
    );
    const preserveSelection =
      currentRange !== undefined &&
      !currentRange.collapsed &&
      rangeBelongsToElement(currentRange, element) &&
      pointRange !== undefined &&
      rangeContainsPoint(currentRange, pointRange);

    let capturedRange: Range;

    if (preserveSelection) {
      capturedRange = currentRange.cloneRange();
    } else if (
      pointRange &&
      rangeBelongsToElement(pointRange, element)
    ) {
      capturedRange = pointRange.cloneRange();
      selection?.removeAllRanges();
      selection?.addRange(capturedRange.cloneRange());
    } else {
      capturedRange = ownerDocument.createRange();
      capturedRange.selectNodeContents(element);
      capturedRange.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(capturedRange.cloneRange());
    }

    this.frozenRange = capturedRange;
    this.frozenText = capturedRange.collapsed
      ? ''
      : capturedRange.toString();

    return {
      interaction: this.createInteraction(
        this.frozenText,
        true,
      ),
      onWheel: (event) => this.scrollByWheel(event),
    };
  }

  undo(): void {
    throw new Error('阅读模式不支持撤销');
  }

  redo(): void {
    throw new Error('阅读模式不支持重做');
  }

  cut(): void {
    throw new Error('阅读模式不支持剪切');
  }

  async copy(): Promise<void> {
    if (this.frozenText) {
      await this.clipboard.writeText(this.frozenText);
    }
  }

  paste(): void {
    throw new Error('阅读模式不支持粘贴');
  }

  selectAll(): void {
    const element = this.requireContainer();
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const selection =
      element.ownerDocument.defaultView?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  find(): void {
    throw new Error('阅读模式暂不支持查找');
  }

  private requireContainer(): HTMLElement {
    const element = this.options.getContainer();

    if (!element) {
      throw new Error('纯文本阅读视图尚未准备完成');
    }
    return element;
  }

  private createInteraction(
    text: string,
    includeEmptyTarget = false,
  ): WorkbenchInteractionSnapshot {
    if (!text && !includeEmptyTarget) {
      return { inputs: [] };
    }

    const source = this.options.getSource();
    const normalizedSource = source.replace(/\r\n/g, '\n');
    const start = text ? normalizedSource.indexOf(text) : -1;
    const selection: WorkbenchSelectionSnapshot | undefined =
      text && start >= 0
        ? {
            text,
            target: createTextRangeTarget(
              PLAIN_TEXT_RANGE_ANCHOR_TYPE,
              source,
              [{ start, end: start + text.length }],
            ),
          }
        : undefined;

    return interactionFromTextSelection(selection);
  }

  private scrollByWheel(event: WorkbenchContextMenuWheelEvent): void {
    const element = this.options.getContainer();

    if (!element) {
      return;
    }

    const scale =
      event.deltaMode === 1
        ? 24
        : event.deltaMode === 2
          ? element.clientHeight
          : 1;
    element.scrollBy({
      left: event.deltaX * scale,
      top: event.deltaY * scale,
    });
  }
}
