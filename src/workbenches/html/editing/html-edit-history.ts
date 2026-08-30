import type { HtmlDomAnchorV1 } from '../shared';

export const HTML_EDIT_HISTORY_LIMIT = 20;

export interface HtmlEditExecutionIdentity {
  readonly taskId: string;
  readonly callKey: string;
  readonly executionId: string;
}

export interface HtmlEditOperation {
  readonly rangeStart: number;
  readonly beforeHtml: string;
  readonly afterHtml: string;
  readonly beforeRevision: string;
  readonly afterRevision: string;
  readonly beforeTarget: HtmlDomAnchorV1;
  readonly afterTarget: HtmlDomAnchorV1;
}

export interface HtmlEditHistoryEntry extends HtmlEditExecutionIdentity {
  readonly operations: readonly HtmlEditOperation[];
}

export interface HtmlEditHistoryState {
  readonly entries: readonly HtmlEditHistoryEntry[];
  readonly cursor: number;
}

export function createHtmlEditHistory(): HtmlEditHistoryState {
  return { entries: [], cursor: 0 };
}

export function commitHtmlEditHistoryEntry(
  history: HtmlEditHistoryState,
  entry: HtmlEditHistoryEntry,
): HtmlEditHistoryState {
  const branched = history.entries.slice(0, history.cursor);
  const appended = [...branched, entry];
  const entries = appended.slice(-HTML_EDIT_HISTORY_LIMIT);
  return { entries, cursor: entries.length };
}

function replaceExact(
  source: string,
  rangeStart: number,
  expected: string,
  replacement: string,
): string {
  if (
    rangeStart < 0 ||
    source.slice(rangeStart, rangeStart + expected.length) !== expected
  ) {
    throw new Error('HTML edit history operation 与当前草稿不一致');
  }
  return (
    source.slice(0, rangeStart) +
    replacement +
    source.slice(rangeStart + expected.length)
  );
}

export function undoHtmlEditHistory(
  history: HtmlEditHistoryState,
  source: string,
  revision: string,
): { readonly history: HtmlEditHistoryState; readonly source: string } {
  if (history.cursor === 0) {
    throw new Error('HTML edit history 没有可撤销步骤');
  }
  const entry = history.entries[history.cursor - 1];
  const last = entry.operations.at(-1);
  if (!last || last.afterRevision !== revision) {
    throw new Error('HTML edit history revision 不连续');
  }

  let nextSource = source;
  for (const operation of [...entry.operations].reverse()) {
    nextSource = replaceExact(
      nextSource,
      operation.rangeStart,
      operation.afterHtml,
      operation.beforeHtml,
    );
  }

  return {
    source: nextSource,
    history: { entries: history.entries, cursor: history.cursor - 1 },
  };
}

export function redoHtmlEditHistory(
  history: HtmlEditHistoryState,
  source: string,
  revision: string,
): { readonly history: HtmlEditHistoryState; readonly source: string } {
  if (history.cursor >= history.entries.length) {
    throw new Error('HTML edit history 没有可重做步骤');
  }
  const entry = history.entries[history.cursor];
  const first = entry.operations[0];
  if (!first || first.beforeRevision !== revision) {
    throw new Error('HTML edit history revision 不连续');
  }

  let nextSource = source;
  for (const operation of entry.operations) {
    nextSource = replaceExact(
      nextSource,
      operation.rangeStart,
      operation.beforeHtml,
      operation.afterHtml,
    );
  }

  return {
    source: nextSource,
    history: { entries: history.entries, cursor: history.cursor + 1 },
  };
}
