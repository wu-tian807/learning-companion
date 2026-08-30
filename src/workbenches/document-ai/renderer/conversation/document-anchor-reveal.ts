import type { EditorView } from '@codemirror/view';

import type { ContentAnchorTarget } from '../../../../shared/workbench/anchor';
import { isTextRangePayload } from '../../../../shared/workbench/text-range-anchor';

export interface RevealTextSelection {
  readonly start: number;
  readonly end: number;
  readonly exact?: string;
}

/**
 * 从工作台 Anchor 中解析出可复现的文本选区。
 * 纯文本 / Markdown 源码的 Anchor 携带 ranges（start/end 偏移），
 * 并把选中的原文存进 exact 字段，供可视化视图按文字回找。
 */
export function resolveTextSelectionFromTarget(
  target: ContentAnchorTarget,
  anchorTypes: readonly string[],
): RevealTextSelection | undefined {
  if (!anchorTypes.includes(target.anchorType)) {
    return undefined;
  }
  if (!isTextRangePayload(target.anchorPayload)) {
    return undefined;
  }

  const range = target.anchorPayload.ranges[0];
  if (!range || range.end <= range.start) {
    return undefined;
  }

  const exact = (range as { readonly exact?: unknown }).exact;
  return {
    start: range.start,
    end: range.end,
    ...(typeof exact === 'string' && exact.trim().length > 0
      ? { exact }
      : {}),
  };
}

/**
 * 在内容为连续纯文本的 DOM 元素（阅读模式）中，按字符偏移选中一段文字。
 */
export function selectOffsetsInElement(
  element: HTMLElement,
  start: number,
  end: number,
): boolean {
  const textNode = firstTextNode(element);
  if (!textNode) {
    return false;
  }

  const length = textNode.nodeValue?.length ?? 0;
  const clampedStart = clampOffset(start, 0, length);
  const clampedEnd = clampOffset(end, clampedStart, length);
  if (clampedEnd <= clampedStart) {
    return false;
  }

  const range = element.ownerDocument.createRange();
  range.setStart(textNode, clampedStart);
  range.setEnd(textNode, clampedEnd);
  applySelection(range);
  return true;
}

/**
 * 在富文本元素（Markdown 可视化编辑器）中按原文搜索并选中。
 * 文字可能被拆分到多个文本节点，这里先拼接全文再回映射节点偏移。
 */
export function selectTextInElement(
  element: HTMLElement,
  text: string,
): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  const match = findTextRange(element, normalized);
  if (!match) {
    return false;
  }

  const range = element.ownerDocument.createRange();
  range.setStart(match.startNode, match.startOffset);
  range.setEnd(match.endNode, match.endOffset);
  applySelection(range);
  return true;
}

/** 在 CodeMirror 编辑器中选中 [start, end) 并滚动到可见区域。 */
export function revealSelectionInCodeMirror(
  view: EditorView | undefined,
  start: number,
  end: number,
): boolean {
  if (!view) {
    return false;
  }

  const length = view.state.doc.length;
  const clampedStart = clampOffset(start, 0, length);
  const clampedEnd = clampOffset(end, clampedStart, length);
  if (clampedEnd <= clampedStart) {
    return false;
  }

  view.dispatch({
    selection: { anchor: clampedStart, head: clampedEnd },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/**
 * 让选区起点尽量出现在滚动容器中央；不传容器时回退到浏览器 scrollIntoView。
 */
export function scrollRangeIntoView(
  range: Range,
  scrollContainer?: HTMLElement | null,
): void {
  const startElement =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  if (!startElement) {
    return;
  }

  if (!scrollContainer) {
    startElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const selectionRect = range.getBoundingClientRect();
  const targetRect =
    selectionRect.width > 0 || selectionRect.height > 0
      ? selectionRect
      : startElement.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  scrollContainer.scrollTop +=
    targetRect.top -
    containerRect.top -
    containerRect.height / 2 +
    targetRect.height / 2;
}

function clampOffset(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(Math.trunc(value), maximum));
}

function firstTextNode(element: HTMLElement): Text | undefined {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );
  const node = walker.nextNode();
  return node === null ? undefined : (node as Text);
}

interface DomTextPosition {
  readonly node: Text;
  /** 该文本节点在整段文字中的起始偏移。 */
  readonly startOffset: number;
  /** 该文本节点在整段文字中的结束偏移（不含）。 */
  readonly endOffset: number;
}

interface DomTextRange {
  readonly startNode: Text;
  readonly startOffset: number;
  readonly endNode: Text;
  readonly endOffset: number;
}

function findTextRange(
  element: HTMLElement,
  text: string,
): DomTextRange | undefined {
  const positions: DomTextPosition[] = [];
  let fullText = '';
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );

  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const value = node.nodeValue ?? '';
    positions.push({
      node: node as Text,
      startOffset: fullText.length,
      endOffset: fullText.length + value.length,
    });
    fullText += value;
  }

  const matchIndex = fullText.indexOf(text);
  if (matchIndex < 0) {
    return undefined;
  }

  const matchEnd = matchIndex + text.length;
  const startPosition = resolvePosition(positions, matchIndex);
  const endPosition = resolvePosition(positions, matchEnd);
  if (!startPosition || !endPosition) {
    return undefined;
  }

  return {
    startNode: startPosition.node,
    startOffset: startPosition.offset,
    endNode: endPosition.node,
    endOffset: endPosition.offset,
  };
}

function resolvePosition(
  positions: readonly DomTextPosition[],
  index: number,
): { readonly node: Text; readonly offset: number } | undefined {
  for (const position of positions) {
    if (index >= position.startOffset && index <= position.endOffset) {
      return {
        node: position.node,
        offset: index - position.startOffset,
      };
    }
  }
  return undefined;
}

function applySelection(range: Range): void {
  const selection =
    range.startContainer.ownerDocument?.defaultView?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
