export interface SelectionSummary {
  readonly characterCount: number;
  readonly preview: string;
}

const SELECTION_PREVIEW_LIMIT = 96;

export function summarizeSelection(text: string): SelectionSummary {
  const normalized = text.replace(/\s+/g, ' ').trim();

  return {
    characterCount: Array.from(text).length,
    preview:
      normalized.length > SELECTION_PREVIEW_LIMIT
        ? `${normalized.slice(0, SELECTION_PREVIEW_LIMIT)}…`
        : normalized,
  };
}
