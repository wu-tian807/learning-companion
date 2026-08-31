import type { TextEncoding, TextLineEnding } from '../../../main/content/text-content';
import type { WorkbenchStateDataDatabaseApi } from '../../../main/workbench/workbench-state-data-database';
import type { HtmlDomAnchorV1 } from '../shared';

export const HTML_DRAFT_HISTORY_LIMIT = 20;
const HTML_DRAFT_DATA_KEY = 'agent-draft';
const HTML_DRAFT_SCHEMA_VERSION = 1;
const HTML_WORKBENCH_ID = 'builtin.html';

export interface HtmlDraftOperation {
  readonly rangeStart: number;
  readonly beforeHtml: string;
  readonly afterHtml: string;
  readonly beforeRevision: string;
  readonly afterRevision: string;
  readonly beforeTarget?: HtmlDomAnchorV1;
  readonly afterTarget?: HtmlDomAnchorV1;
}

export interface HtmlDraftHistoryEntry {
  readonly taskId: string;
  readonly operations: readonly HtmlDraftOperation[];
}

export interface HtmlDraftSession {
  readonly version: typeof HTML_DRAFT_SCHEMA_VERSION;
  readonly projectId: string;
  readonly assetId: string;
  readonly sourceRevision: string;
  readonly syncedDraftRevision: string;
  readonly draftRevision: string;
  readonly encoding: TextEncoding;
  readonly lineEnding: TextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly draft: string;
  readonly history: {
    readonly entries: readonly HtmlDraftHistoryEntry[];
    readonly cursor: number;
  };
  readonly pending?: {
    readonly taskId: string;
    readonly beforeDraft: string;
    readonly beforeRevision: string;
    readonly operations: readonly HtmlDraftOperation[];
  };
  readonly syncRequested: boolean;
  readonly conflict?: 'SOURCE_REVISION_MISMATCH' | 'RECOVERY_INCONSISTENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOperation(value: unknown): value is HtmlDraftOperation {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.rangeStart) &&
    (value.rangeStart as number) >= 0 &&
    typeof value.beforeHtml === 'string' &&
    typeof value.afterHtml === 'string' &&
    typeof value.beforeRevision === 'string' &&
    typeof value.afterRevision === 'string'
  );
}

function isSession(value: unknown): value is HtmlDraftSession {
  if (
    !isRecord(value) ||
    value.version !== HTML_DRAFT_SCHEMA_VERSION ||
    typeof value.projectId !== 'string' ||
    typeof value.assetId !== 'string' ||
    typeof value.sourceRevision !== 'string' ||
    typeof value.syncedDraftRevision !== 'string' ||
    typeof value.draftRevision !== 'string' ||
    (value.encoding !== 'utf-8' && value.encoding !== 'gbk') ||
    (value.lineEnding !== 'lf' && value.lineEnding !== 'crlf') ||
    typeof value.hasByteOrderMark !== 'boolean' ||
    typeof value.draft !== 'string' ||
    typeof value.syncRequested !== 'boolean' ||
    (value.conflict !== undefined &&
      value.conflict !== 'SOURCE_REVISION_MISMATCH' &&
      value.conflict !== 'RECOVERY_INCONSISTENT') ||
    !isRecord(value.history) ||
    !Array.isArray(value.history.entries) ||
    value.history.entries.length > HTML_DRAFT_HISTORY_LIMIT ||
    !Number.isSafeInteger(value.history.cursor) ||
    (value.history.cursor as number) < 0 ||
    (value.history.cursor as number) > value.history.entries.length
  ) {
    return false;
  }
  if (
    !value.history.entries.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.taskId === 'string' &&
        Array.isArray(entry.operations) &&
        entry.operations.length > 0 &&
        entry.operations.every(isOperation),
    )
  ) {
    return false;
  }
  return (
    value.pending === undefined ||
    (isRecord(value.pending) &&
      typeof value.pending.taskId === 'string' &&
      typeof value.pending.beforeDraft === 'string' &&
      typeof value.pending.beforeRevision === 'string' &&
      Array.isArray(value.pending.operations) &&
      value.pending.operations.length > 0 &&
      value.pending.operations.every(isOperation))
  );
}

export class HtmlDraftStore {
  constructor(
    private readonly data: WorkbenchStateDataDatabaseApi,
    private readonly now: () => number = Date.now,
  ) {}

  async load(assetId: string): Promise<HtmlDraftSession | undefined> {
    const record = await this.data.get(
      assetId,
      HTML_WORKBENCH_ID,
      HTML_DRAFT_DATA_KEY,
    );
    if (!record) return undefined;

    let decoded: unknown;
    try {
      decoded = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(record.data),
      );
    } catch {
      throw new Error('HTML Workbench 草稿数据损坏');
    }
    if (!isSession(decoded) || decoded.assetId !== assetId) {
      throw new Error('HTML Workbench 草稿状态无效');
    }
    return structuredClone(decoded);
  }

  async save(session: HtmlDraftSession): Promise<void> {
    const updatedTime = this.now();
    await this.data.save({
      assetId: session.assetId,
      workbenchId: HTML_WORKBENCH_ID,
      dataKey: HTML_DRAFT_DATA_KEY,
      data: new TextEncoder().encode(JSON.stringify(session)),
      updatedTime,
    });
  }

  async delete(assetId: string): Promise<void> {
    await this.data.delete(assetId, HTML_WORKBENCH_ID, HTML_DRAFT_DATA_KEY);
  }
}
