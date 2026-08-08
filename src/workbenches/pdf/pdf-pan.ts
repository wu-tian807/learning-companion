export interface PdfPanStartInput {
  readonly button: number;
  readonly isPrimary: boolean;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly blockedTarget: boolean;
}

export interface PdfPanOrigin {
  readonly clientX: number;
  readonly clientY: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

export function hasPdfHorizontalOverflow(
  scrollWidth: number,
  clientWidth: number,
): boolean {
  return scrollWidth > clientWidth + 1;
}

export function canStartPdfPan(input: PdfPanStartInput): boolean {
  return (
    input.isPrimary &&
    input.button === 0 &&
    !input.blockedTarget &&
    hasPdfHorizontalOverflow(input.scrollWidth, input.clientWidth)
  );
}

export function calculatePdfPanScroll(
  origin: PdfPanOrigin,
  clientX: number,
  clientY: number,
): Readonly<{ left: number; top: number }> {
  return Object.freeze({
    left: origin.scrollLeft - (clientX - origin.clientX),
    top: origin.scrollTop - (clientY - origin.clientY),
  });
}
