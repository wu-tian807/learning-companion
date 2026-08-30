import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import { createTextRevision, type TextEncoding, type TextLineEnding } from '../../../main/content/text-content';
import { isHtmlDomAnchorV1 } from '../shared';
import type {
  HtmlEditExecutionIdentity,
  HtmlEditHistoryEntry,
  HtmlEditHistoryState,
  HtmlEditOperation,
} from './html-edit-history';

export const HTML_EDITING_SESSION_VERSION = 1;

export interface HtmlEditingPendingState extends HtmlEditExecutionIdentity {
  readonly initialRevision: string;
  readonly operations: readonly HtmlEditOperation[];
  readonly stagedOperation?: HtmlEditOperation;
}

export interface HtmlEditingSessionManifest {
  readonly version: typeof HTML_EDITING_SESSION_VERSION;
  readonly projectId: string;
  readonly assetId: string;
  readonly sourceRevision: string;
  readonly syncedDraftRevision: string;
  readonly draftRevision: string;
  readonly encoding: TextEncoding;
  readonly lineEnding: TextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly history: HtmlEditHistoryState;
  readonly pending?: HtmlEditingPendingState;
  readonly syncRequested: boolean;
  readonly conflict?: 'SOURCE_REVISION_MISMATCH' | 'RECOVERY_INCONSISTENT';
}

export interface LoadedHtmlEditingSession {
  readonly manifest: HtmlEditingSessionManifest;
  readonly draft: string;
  readonly actualDraftRevision: string;
}

export class HtmlEditingRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HtmlEditingRecoveryError';
  }
}

function revisionOf(content: string): string {
  return createTextRevision(new TextEncoder().encode(content));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIdentity(
  value: unknown,
): value is Record<string, unknown> & HtmlEditExecutionIdentity {
  return (
    isRecord(value) &&
    isNonEmptyString(value.taskId) &&
    isNonEmptyString(value.callKey) &&
    isNonEmptyString(value.executionId)
  );
}

function isOperation(value: unknown): value is HtmlEditOperation {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.rangeStart) &&
    (value.rangeStart as number) >= 0 &&
    typeof value.beforeHtml === 'string' &&
    typeof value.afterHtml === 'string' &&
    isNonEmptyString(value.beforeRevision) &&
    isNonEmptyString(value.afterRevision) &&
    isHtmlDomAnchorV1(value.beforeTarget) &&
    isHtmlDomAnchorV1(value.afterTarget)
  );
}

function isEntry(value: unknown): value is HtmlEditHistoryEntry {
  return (
    isIdentity(value) &&
    Array.isArray(value.operations) &&
    value.operations.length > 0 &&
    value.operations.every(isOperation)
  );
}

function isHistory(value: unknown): value is HtmlEditHistoryState {
  return (
    isRecord(value) &&
    Array.isArray(value.entries) &&
    value.entries.length <= 20 &&
    value.entries.every(isEntry) &&
    Number.isSafeInteger(value.cursor) &&
    (value.cursor as number) >= 0 &&
    (value.cursor as number) <= value.entries.length
  );
}

function isPending(value: unknown): value is HtmlEditingPendingState {
  return (
    isIdentity(value) &&
    isNonEmptyString(value.initialRevision) &&
    Array.isArray(value.operations) &&
    value.operations.every(isOperation) &&
    (value.stagedOperation === undefined || isOperation(value.stagedOperation))
  );
}

function isManifest(value: unknown): value is HtmlEditingSessionManifest {
  return (
    isRecord(value) &&
    value.version === HTML_EDITING_SESSION_VERSION &&
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.assetId) &&
    isNonEmptyString(value.sourceRevision) &&
    isNonEmptyString(value.syncedDraftRevision) &&
    isNonEmptyString(value.draftRevision) &&
    isNonEmptyString(value.encoding) &&
    (value.lineEnding === 'lf' || value.lineEnding === 'crlf') &&
    typeof value.hasByteOrderMark === 'boolean' &&
    isHistory(value.history) &&
    (value.pending === undefined || isPending(value.pending)) &&
    typeof value.syncRequested === 'boolean' &&
    (value.conflict === undefined ||
      value.conflict === 'SOURCE_REVISION_MISMATCH' ||
      value.conflict === 'RECOVERY_INCONSISTENT')
  );
}

function sessionDigest(projectId: string, assetId: string): string {
  return createHash('sha256')
    .update(JSON.stringify([projectId, assetId]))
    .digest('hex');
}

function isNotFound(error: unknown): boolean {
  return (
    isRecord(error) &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

export class HtmlEditingSessionFile {
  constructor(private readonly recoveryRoot: string) {
    if (!recoveryRoot.trim()) {
      throw new Error('HTML editing recovery root 不能为空');
    }
  }

  directory(projectId: string, assetId: string): string {
    return join(
      this.recoveryRoot,
      'html-agent-editing',
      sessionDigest(projectId, assetId),
    );
  }

  async load(
    projectId: string,
    assetId: string,
  ): Promise<LoadedHtmlEditingSession | undefined> {
    const directory = this.directory(projectId, assetId);
    let encoded: string;
    try {
      encoded = await readFile(join(directory, 'session.json'), 'utf8');
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
      try {
        const files = await readdir(directory);
        if (files.length > 0) {
          throw new HtmlEditingRecoveryError(
            'HTML editing recovery 缺少 session manifest',
          );
        }
      } catch (directoryError) {
        if (!isNotFound(directoryError)) {
          throw directoryError;
        }
      }
      return undefined;
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(encoded);
    } catch {
      throw new HtmlEditingRecoveryError('HTML editing session JSON 损坏');
    }
    if (
      !isManifest(manifest) ||
      manifest.projectId !== projectId ||
      manifest.assetId !== assetId
    ) {
      throw new HtmlEditingRecoveryError('HTML editing session manifest 无效');
    }

    let draft: string;
    try {
      draft = await readFile(join(directory, 'draft.html'), 'utf8');
    } catch {
      throw new HtmlEditingRecoveryError('HTML editing draft 无法读取');
    }
    const actualDraftRevision = revisionOf(draft);

    return { manifest, draft, actualDraftRevision };
  }

  async create(manifest: HtmlEditingSessionManifest, draft: string): Promise<void> {
    const directory = this.directory(manifest.projectId, manifest.assetId);
    await mkdir(directory, { recursive: true });
    await writeFileAtomic(join(directory, 'draft.html'), draft, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await this.writeManifest(manifest);
  }

  async writeManifest(manifest: HtmlEditingSessionManifest): Promise<void> {
    const directory = this.directory(manifest.projectId, manifest.assetId);
    await mkdir(directory, { recursive: true });
    await writeFileAtomic(
      join(directory, 'session.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  async writeDraft(
    projectId: string,
    assetId: string,
    draft: string,
  ): Promise<void> {
    await writeFileAtomic(
      join(this.directory(projectId, assetId), 'draft.html'),
      draft,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  async writeCheckpoint(
    projectId: string,
    assetId: string,
    content: string,
  ): Promise<void> {
    await writeFileAtomic(
      join(this.directory(projectId, assetId), 'pending-before.html'),
      content,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  async readCheckpoint(projectId: string, assetId: string): Promise<string> {
    try {
      return await readFile(
        join(this.directory(projectId, assetId), 'pending-before.html'),
        'utf8',
      );
    } catch {
      throw new HtmlEditingRecoveryError(
        'HTML editing pending checkpoint 无法读取',
      );
    }
  }

  async removeCheckpoint(projectId: string, assetId: string): Promise<void> {
    try {
      await unlink(
        join(this.directory(projectId, assetId), 'pending-before.html'),
      );
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }

  async discard(projectId: string, assetId: string): Promise<void> {
    await rm(this.directory(projectId, assetId), {
      recursive: true,
      force: true,
    });
  }
}

export function createHtmlDraftRevision(content: string): string {
  return revisionOf(content);
}
