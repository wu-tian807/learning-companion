import type { WorkbenchInteractionSnapshot } from '../../shared/workbench/interaction';
import {
  interactionFromTextSelection,
  type WorkbenchSelectionSnapshot,
} from '../../shared/workbench/selection';
import { createTextRangeTarget } from '../../shared/workbench/text-range-target';
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
  readonly getScrollContainer: () => HTMLElement | null | undefined;
  readonly getContentElement: () => HTMLElement | null | undefined;
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

function selectionFromDomRange(
  range: Range,
  contentElement: HTMLElement,
  source: string,
): WorkbenchSelectionSnapshot | undefined {
  if (
    range.collapsed ||
    !rangeBelongsToElement(range, contentElement)
  ) {
    return undefined;
  }

  try {
    const startRange = contentElement.ownerDocument.createRange();
    startRange.selectNodeContents(contentElement);
    startRange.setEnd(range.startContainer, range.startOffset);

    const endRange = contentElement.ownerDocument.createRange();
    endRange.selectNodeContents(contentElement);
    endRange.setEnd(range.endContainer, range.endOffset);

    const start = startRange.toString().length;
    const end = endRange.toString().length;
    const text = source.slice(start, end);

    if (
      start < 0 ||
      end <= start ||
      end > source.length ||
      text !== range.toString()
    ) {
      return undefined;
    }

    return {
      text,
      target: createTextRangeTarget(
        PLAIN_TEXT_RANGE_ANCHOR_TYPE,
        source,
        [{ start, end }],
      ),
    };
  } catch {
    return undefined;
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
    const ready = Boolean(this.options.getContentElement());
    const hasSelection =
      ready &&
      this.frozenRange !== undefined &&
      !this.frozenRange.collapsed &&
      this.frozenText.length > 0;

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
    const element = this.options.getContentElement();
    const selection =
      element?.ownerDocument.defaultView?.getSelection();

    if (!element || !selection || selection.rangeCount === 0) {
      return { inputs: [] };
    }

    const range = selection.getRangeAt(0);

    return interactionFromTextSelection(
      selectionFromDomRange(
        range,
        element,
        this.options.getSource(),
      ),
    );
  }

  captureContextMenu(
    clientX: number,
    clientY: number,
  ): EditorContextMenuCapture {
    const element = this.requireContentElement();
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
    const frozenSelection = selectionFromDomRange(
      capturedRange,
      element,
      this.options.getSource(),
    );
    this.frozenText = frozenSelection?.text ?? '';

    return {
      interaction: interactionFromTextSelection(frozenSelection),
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
    const element = this.requireContentElement();
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

  private requireContentElement(): HTMLElement {
    const element = this.options.getContentElement();

    if (!element) {
      throw new Error('纯文本阅读视图尚未准备完成');
    }
    return element;
  }

  private scrollByWheel(event: WorkbenchContextMenuWheelEvent): void {
    const element = this.options.getScrollContainer();

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
