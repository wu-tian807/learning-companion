function sameRange(left: Range, right: Range): boolean {
  return (
    left.startContainer === right.startContainer &&
    left.startOffset === right.startOffset &&
    left.endContainer === right.endContainer &&
    left.endOffset === right.endOffset
  );
}

export function emphasizeEpubRange(
  range: Range,
  durationMs = 1_600,
): () => void {
  const ownerDocument = range.startContainer.ownerDocument;
  const selection = ownerDocument?.getSelection();
  if (!selection) return () => undefined;

  selection.removeAllRanges();
  selection.addRange(range);
  let active = true;
  const clearSelection = () => {
    if (!active) return;
    active = false;
    window.clearTimeout(timer);
    if (
      selection.rangeCount === 1 &&
      sameRange(selection.getRangeAt(0), range)
    ) {
      selection.removeAllRanges();
    }
  };
  const timer = window.setTimeout(clearSelection, durationMs);
  return clearSelection;
}
