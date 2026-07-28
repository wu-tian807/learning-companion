import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
import type { WorkbenchSelectionSnapshot } from '../../shared/workbench/selection';
import type { WorkbenchContextMenuWheelEvent } from '../../renderer/workbench/runtime/workbench-runtime-store';
import type {
  EditorActionAdapter,
  EditorActionState,
  EditorContextMenuCapture,
} from '../../renderer/workbench/editor/editor-action-adapter';
import { MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE } from './shared';
import type { MarkdownEditorAdapter } from './markdown-editor-adapter';

export interface MarkdownEditorActionAdapterOptions {
  readonly getEditor: () => MarkdownEditorAdapter | undefined;
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

function createVisualSelectionTarget(text: string): ContentAnchorTarget {
  return {
    scope: 'content',
    anchorType: MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
    anchorVersion: 1,
    anchorPayload: {
      exact: text,
    },
  };
}

export class MarkdownEditorActionAdapter
  implements EditorActionAdapter
{
  private readonly clipboard: {
    readonly readText: () => Promise<string>;
    readonly writeText: (text: string) => Promise<void>;
  };
  private frozenRange: Range | undefined;
  private frozenText = '';

  constructor(
    private readonly options: MarkdownEditorActionAdapterOptions,
  ) {
    this.clipboard = options.clipboard ?? defaultClipboard();
  }

  getState(): EditorActionState {
    const editor = this.options.getEditor();
    const ready = editor?.getEditableElement() !== undefined;
    const hasSelection =
      ready &&
      this.frozenRange !== undefined &&
      !this.frozenRange.collapsed;

    return {
      canUndo: editor?.canUndo() ?? false,
      canRedo: editor?.canRedo() ?? false,
      canCut: hasSelection,
      canCopy: hasSelection,
      canPaste: ready,
      canSelectAll: ready,
      canFind: false,
    };
  }

  captureContextMenu(
    clientX: number,
    clientY: number,
  ): EditorContextMenuCapture {
    const editor = this.requireEditor();
    const element = this.requireEditableElement(editor);
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

    const target = createVisualSelectionTarget(this.frozenText);
    const selected: WorkbenchSelectionSnapshot | undefined =
      this.frozenText
        ? {
            text: this.frozenText,
            target,
          }
        : undefined;

    return {
      interaction: {
        target,
        selection: selected,
      },
      onWheel: (event) => this.scrollByWheel(event),
    };
  }

  undo(): void {
    const editor = this.requireEditor();
    this.restoreFrozenRange(editor);
    editor.undo();
  }

  redo(): void {
    const editor = this.requireEditor();
    this.restoreFrozenRange(editor);
    editor.redo();
  }

  async cut(): Promise<void> {
    if (!this.frozenText) {
      return;
    }

    await this.clipboard.writeText(this.frozenText);
    const editor = this.requireEditor();
    this.restoreFrozenRange(editor);
    editor.deleteSelection();
  }

  async copy(): Promise<void> {
    if (this.frozenText) {
      await this.clipboard.writeText(this.frozenText);
    }
  }

  async paste(): Promise<void> {
    const editor = this.requireEditor();
    const value = await this.clipboard.readText();
    this.restoreFrozenRange(editor);

    if (this.frozenRange && !this.frozenRange.collapsed) {
      editor.deleteSelection();
    }
    editor.insertPlainText(value);
  }

  selectAll(): void {
    this.requireEditor().selectAll();
  }

  find(): void {
    throw new Error('Markdown 可视化编辑器暂不支持查找');
  }

  private requireEditor(): MarkdownEditorAdapter {
    const editor = this.options.getEditor();

    if (!editor) {
      throw new Error('Markdown 可视化编辑器尚未准备完成');
    }
    return editor;
  }

  private requireEditableElement(
    editor: MarkdownEditorAdapter,
  ): HTMLElement {
    const element = editor.getEditableElement();

    if (!element) {
      throw new Error('Markdown 可视化编辑器尚未准备完成');
    }
    return element;
  }

  private restoreFrozenRange(editor: MarkdownEditorAdapter): void {
    if (!this.frozenRange) {
      throw new Error('Markdown 编辑器选区已经失效');
    }

    const element = this.requireEditableElement(editor);

    if (!rangeBelongsToElement(this.frozenRange, element)) {
      throw new Error('Markdown 编辑器选区已经失效');
    }

    element.focus();
    const selection = element.ownerDocument.defaultView?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(this.frozenRange.cloneRange());
  }

  private scrollByWheel(event: WorkbenchContextMenuWheelEvent): void {
    const editor = this.options.getEditor();
    const element = editor?.getEditableElement();

    if (!editor || !element) {
      return;
    }

    const scale =
      event.deltaMode === 1
        ? 24
        : event.deltaMode === 2
          ? element.clientHeight
          : 1;
    editor.scrollBy(event.deltaX * scale, event.deltaY * scale);
  }
}
