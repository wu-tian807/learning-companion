import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
import type { JsonValue } from '../../shared/workbench/protocol';
import type { WorkbenchInteractionSnapshot } from '../../shared/workbench/interaction';
import {
  interactionFromTextSelection,
  type WorkbenchSelectionSnapshot,
} from '../../shared/workbench/selection';
import type { WorkbenchContextMenuWheelEvent } from '../../renderer/workbench/runtime/workbench-runtime-store';
import type {
  EditorActionAdapter,
  EditorActionState,
  EditorContextMenuCapture,
} from '../../renderer/workbench/editor/editor-action-adapter';
import { createTextRangeTarget } from '../../shared/workbench/text-range-anchor';
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

function allStarts(content: string, exact: string): readonly number[] {
  if (!exact) return [];
  const starts: number[] = [];
  let from = 0;
  while (from <= content.length - exact.length) {
    const found = content.indexOf(exact, from);
    if (found < 0) break;
    starts.push(found);
    from = found + 1;
  }
  return starts;
}

export function resolveMarkdownVisualSelectionSourceRange(input: {
  readonly source: string;
  readonly selectedMarkdown: string;
  readonly selectedText: string;
  readonly renderedPrefix: string;
  readonly renderedDocument: string;
}): { readonly start: number; readonly end: number } | undefined {
  const exact = input.selectedMarkdown.trim();
  if (!exact) return undefined;
  const renderedSuffix = input.renderedDocument.slice(
    input.renderedPrefix.length + input.selectedText.length,
  );
  const visualExact = input.selectedText.trim();
  const sourceStarts = allStarts(input.source, exact).filter((start) => {
    if (exact !== visualExact) return true;
    const end = start + exact.length;
    return (
      input.source.slice(0, start) === input.renderedPrefix ||
      input.source.slice(end) === renderedSuffix
    );
  });
  if (sourceStarts.length === 1) {
    return {
      start: sourceStarts[0]!,
      end: sourceStarts[0]! + exact.length,
    };
  }
  const renderedStarts = allStarts(
    input.renderedDocument,
    input.selectedText,
  );
  const occurrence = allStarts(
    input.renderedPrefix,
    input.selectedText,
  ).length;
  if (
    sourceStarts.length > 1 &&
    sourceStarts.length === renderedStarts.length &&
    occurrence < sourceStarts.length
  ) {
    const start = sourceStarts[occurrence]!;
    return { start, end: start + exact.length };
  }
  return undefined;
}

function renderedPrefixForRange(
  element: HTMLElement,
  range: Range,
): string {
  const prefix = element.ownerDocument.createRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString();
}

function createVisualSelectionTarget(
  text: string,
  editor?: MarkdownEditorAdapter,
  range?: Range,
  element?: HTMLElement,
): ContentAnchorTarget {
  const base = {
    scope: 'content',
    anchorType: MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
    anchorVersion: 1,
  } as const;
  if (!text || !editor || !range || !element) {
    return { ...base, anchorPayload: { exact: text } };
  }
  const source = editor.getValue();
  const sourceRange = resolveMarkdownVisualSelectionSourceRange({
    source,
    selectedMarkdown: editor.getMarkdownForRange(range),
    selectedText: text,
    renderedPrefix: renderedPrefixForRange(element, range),
    renderedDocument: element.textContent ?? '',
  });
  if (!sourceRange) {
    return { ...base, anchorPayload: { exact: text } };
  }
  const ranged = createTextRangeTarget(
    MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
    source,
    [sourceRange],
  );
  return {
    ...ranged,
    anchorPayload: {
      exact: text,
      ...(ranged.anchorPayload as {
        readonly ranges: readonly JsonValue[];
      }),
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

  captureInteraction(): WorkbenchInteractionSnapshot {
    const editor = this.options.getEditor();
    const element = editor?.getEditableElement();
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

    const text = range.toString();
    return createVisualInteraction(
      text,
      false,
      createVisualSelectionTarget(text, editor, range, element),
    );
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

    return {
      interaction: createVisualInteraction(
        this.frozenText,
        true,
        createVisualSelectionTarget(
          this.frozenText,
          editor,
          capturedRange,
          element,
        ),
      ),
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

function createVisualInteraction(
  text: string,
  includeEmptyTarget = false,
  target: ContentAnchorTarget = createVisualSelectionTarget(text),
): WorkbenchInteractionSnapshot {
  if (!text && !includeEmptyTarget) {
    return { inputs: [] };
  }

  const selection: WorkbenchSelectionSnapshot | undefined = text
    ? {
        text,
        target,
      }
    : undefined;

  return interactionFromTextSelection(selection, target);
}
