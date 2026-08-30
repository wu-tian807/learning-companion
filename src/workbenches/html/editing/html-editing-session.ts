import type { ResolvedTextContent } from '../../../main/content/text-content';
import {
  commitHtmlEditHistoryEntry,
  createHtmlEditHistory,
  redoHtmlEditHistory,
  undoHtmlEditHistory,
  type HtmlEditExecutionIdentity,
  type HtmlEditOperation,
} from './html-edit-history';
import {
  createHtmlDraftRevision,
  HTML_EDITING_SESSION_VERSION,
  HtmlEditingRecoveryError,
  HtmlEditingSessionFile,
  type HtmlEditingSessionManifest,
  type LoadedHtmlEditingSession,
} from './html-editing-session-file';

export interface ApplyHtmlDraftOperation {
  readonly identity: HtmlEditExecutionIdentity;
  readonly rangeStart: number;
  readonly beforeHtml: string;
  readonly afterHtml: string;
  readonly beforeTarget: HtmlEditOperation['beforeTarget'];
  readonly afterTarget: HtmlEditOperation['afterTarget'];
  readonly nextDraft: string;
}

function sameIdentity(
  left: HtmlEditExecutionIdentity,
  right: HtmlEditExecutionIdentity,
): boolean {
  return (
    left.taskId === right.taskId &&
    left.callKey === right.callKey &&
    left.executionId === right.executionId
  );
}

export class HtmlEditingSession {
  private constructor(
    private readonly files: HtmlEditingSessionFile,
    private manifest: HtmlEditingSessionManifest,
    private draft: string,
  ) {}

  static async openOrCreate(
    files: HtmlEditingSessionFile,
    projectId: string,
    assetId: string,
    source: ResolvedTextContent,
  ): Promise<HtmlEditingSession> {
    const loaded = await files.load(projectId, assetId);
    if (!loaded) {
      const draftRevision = createHtmlDraftRevision(source.content);
      const manifest: HtmlEditingSessionManifest = {
        version: HTML_EDITING_SESSION_VERSION,
        projectId,
        assetId,
        sourceRevision: source.revision,
        syncedDraftRevision: draftRevision,
        draftRevision,
        encoding: source.encoding,
        lineEnding: source.lineEnding,
        hasByteOrderMark: source.hasByteOrderMark,
        history: createHtmlEditHistory(),
        syncRequested: false,
      };
      await files.create(manifest, source.content);
      return new HtmlEditingSession(files, manifest, source.content);
    }

    return this.restore(files, loaded, source.revision, source.content);
  }

  static async openExisting(
    files: HtmlEditingSessionFile,
    projectId: string,
    assetId: string,
    sourceRevision?: string,
    sourceContent?: string,
  ): Promise<HtmlEditingSession | undefined> {
    const loaded = await files.load(projectId, assetId);
    return loaded
      ? this.restore(files, loaded, sourceRevision, sourceContent)
      : undefined;
  }

  private static async restore(
    files: HtmlEditingSessionFile,
    loaded: LoadedHtmlEditingSession,
    sourceRevision?: string,
    sourceContent?: string,
  ): Promise<HtmlEditingSession> {
    let manifest = loaded.manifest;
    if (manifest.pending?.stagedOperation) {
      const staged = manifest.pending.stagedOperation;
      if (loaded.actualDraftRevision === staged.afterRevision) {
        manifest = {
          ...manifest,
          draftRevision: staged.afterRevision,
          pending: {
            ...manifest.pending,
            operations: [...manifest.pending.operations, staged],
            stagedOperation: undefined,
          },
        };
      } else if (loaded.actualDraftRevision === staged.beforeRevision) {
        manifest = manifest.pending.operations.length === 0
          ? { ...manifest, pending: undefined }
          : {
              ...manifest,
              pending: {
                ...manifest.pending,
                stagedOperation: undefined,
              },
            };
      } else {
        throw new HtmlEditingRecoveryError(
          'HTML editing staged operation revision 无法恢复',
        );
      }
      await files.writeManifest(manifest);
      if (!manifest.pending) {
        await files.removeCheckpoint(manifest.projectId, manifest.assetId);
      }
    }

    if (loaded.actualDraftRevision !== manifest.draftRevision) {
      const pending = manifest.pending;
      if (
        pending &&
        !pending.stagedOperation &&
        loaded.actualDraftRevision === pending.initialRevision
      ) {
        manifest = {
          ...manifest,
          draftRevision: pending.initialRevision,
          pending: undefined,
        };
        await files.writeManifest(manifest);
        await files.removeCheckpoint(manifest.projectId, manifest.assetId);
      } else if (!pending) {
        const undoEntry = manifest.history.entries[manifest.history.cursor - 1];
        const redoEntry = manifest.history.entries[manifest.history.cursor];
        const undoRevision = undoEntry?.operations[0]?.beforeRevision;
        const redoRevision = redoEntry?.operations.at(-1)?.afterRevision;
        if (loaded.actualDraftRevision === undoRevision) {
          manifest = {
            ...manifest,
            draftRevision: loaded.actualDraftRevision,
            history: {
              ...manifest.history,
              cursor: manifest.history.cursor - 1,
            },
          };
          await files.writeManifest(manifest);
        } else if (loaded.actualDraftRevision === redoRevision) {
          manifest = {
            ...manifest,
            draftRevision: loaded.actualDraftRevision,
            history: {
              ...manifest.history,
              cursor: manifest.history.cursor + 1,
            },
          };
          await files.writeManifest(manifest);
        } else {
          throw new HtmlEditingRecoveryError(
            'HTML editing draft revision 无法恢复',
          );
        }
      } else {
        throw new HtmlEditingRecoveryError(
          'HTML editing draft revision 无法恢复',
        );
      }
    }

    if (
      sourceRevision !== undefined &&
      sourceRevision !== manifest.sourceRevision &&
      !manifest.conflict
    ) {
      manifest =
        manifest.syncRequested &&
        !manifest.pending &&
        sourceContent === loaded.draft
          ? {
              ...manifest,
              sourceRevision,
              syncedDraftRevision: manifest.draftRevision,
              syncRequested: false,
            }
          : { ...manifest, conflict: 'SOURCE_REVISION_MISMATCH' };
      await files.writeManifest(manifest);
    }
    return new HtmlEditingSession(files, manifest, loaded.draft);
  }

  getManifest(): HtmlEditingSessionManifest {
    return structuredClone(this.manifest);
  }

  getDraft(): string {
    return this.draft;
  }

  async applyOperation(request: ApplyHtmlDraftOperation): Promise<void> {
    this.assertUsable();
    if (createHtmlDraftRevision(this.draft) !== this.manifest.draftRevision) {
      throw new HtmlEditingRecoveryError('当前 HTML draft revision 无效');
    }
    if (
      this.draft.slice(
        request.rangeStart,
        request.rangeStart + request.beforeHtml.length,
      ) !== request.beforeHtml ||
      request.nextDraft !==
        this.draft.slice(0, request.rangeStart) +
          request.afterHtml +
          this.draft.slice(request.rangeStart + request.beforeHtml.length)
    ) {
      throw new HtmlEditingRecoveryError('HTML draft operation 与冻结区域不一致');
    }

    let pending = this.manifest.pending;
    if (pending && !sameIdentity(pending, request.identity)) {
      throw new HtmlEditingRecoveryError('另一个 Agent execution 仍有待收口修改');
    }
    if (!pending) {
      await this.files.writeCheckpoint(
        this.manifest.projectId,
        this.manifest.assetId,
        this.draft,
      );
      pending = {
        ...request.identity,
        initialRevision: this.manifest.draftRevision,
        operations: [],
      };
    }

    const operation: HtmlEditOperation = {
      rangeStart: request.rangeStart,
      beforeHtml: request.beforeHtml,
      afterHtml: request.afterHtml,
      beforeRevision: this.manifest.draftRevision,
      afterRevision: createHtmlDraftRevision(request.nextDraft),
      beforeTarget: request.beforeTarget,
      afterTarget: request.afterTarget,
    };
    this.manifest = {
      ...this.manifest,
      pending: { ...pending, stagedOperation: operation },
    };
    await this.files.writeManifest(this.manifest);
    await this.files.writeDraft(
      this.manifest.projectId,
      this.manifest.assetId,
      request.nextDraft,
    );

    this.draft = request.nextDraft;
    this.manifest = {
      ...this.manifest,
      draftRevision: operation.afterRevision,
      pending: {
        ...pending,
        operations: [...pending.operations, operation],
      },
    };
    await this.files.writeManifest(this.manifest);
  }

  async settle(identity: HtmlEditExecutionIdentity): Promise<boolean> {
    this.assertUsable();
    const pending = this.manifest.pending;
    if (!pending || !sameIdentity(pending, identity)) {
      return false;
    }
    if (pending.stagedOperation || pending.operations.length === 0) {
      throw new HtmlEditingRecoveryError('HTML pending operation 尚未完整持久化');
    }

    this.manifest = {
      ...this.manifest,
      history: commitHtmlEditHistoryEntry(this.manifest.history, {
        ...identity,
        operations: pending.operations,
      }),
      pending: undefined,
    };
    await this.files.writeManifest(this.manifest);
    await this.files.removeCheckpoint(
      this.manifest.projectId,
      this.manifest.assetId,
    );
    return true;
  }

  async rollback(identity: HtmlEditExecutionIdentity): Promise<boolean> {
    const pending = this.manifest.pending;
    if (!pending || !sameIdentity(pending, identity)) {
      return false;
    }
    const checkpoint = await this.files.readCheckpoint(
      this.manifest.projectId,
      this.manifest.assetId,
    );
    if (createHtmlDraftRevision(checkpoint) !== pending.initialRevision) {
      throw new HtmlEditingRecoveryError('HTML pending checkpoint revision 无效');
    }

    await this.files.writeDraft(
      this.manifest.projectId,
      this.manifest.assetId,
      checkpoint,
    );
    this.draft = checkpoint;
    this.manifest = {
      ...this.manifest,
      draftRevision: pending.initialRevision,
      pending: undefined,
    };
    await this.files.writeManifest(this.manifest);
    await this.files.removeCheckpoint(
      this.manifest.projectId,
      this.manifest.assetId,
    );
    return true;
  }

  async undo(): Promise<void> {
    this.assertNoPending();
    const result = undoHtmlEditHistory(
      this.manifest.history,
      this.draft,
      this.manifest.draftRevision,
    );
    const revision = createHtmlDraftRevision(result.source);
    await this.files.writeDraft(
      this.manifest.projectId,
      this.manifest.assetId,
      result.source,
    );
    this.draft = result.source;
    this.manifest = {
      ...this.manifest,
      draftRevision: revision,
      history: result.history,
    };
    await this.files.writeManifest(this.manifest);
  }

  async redo(): Promise<void> {
    this.assertNoPending();
    const result = redoHtmlEditHistory(
      this.manifest.history,
      this.draft,
      this.manifest.draftRevision,
    );
    const revision = createHtmlDraftRevision(result.source);
    await this.files.writeDraft(
      this.manifest.projectId,
      this.manifest.assetId,
      result.source,
    );
    this.draft = result.source;
    this.manifest = {
      ...this.manifest,
      draftRevision: revision,
      history: result.history,
    };
    await this.files.writeManifest(this.manifest);
  }

  async requestSync(waitForActiveEdit = false): Promise<'queued' | 'ready'> {
    this.assertUsable();
    this.manifest = { ...this.manifest, syncRequested: true };
    await this.files.writeManifest(this.manifest);
    return this.manifest.pending || waitForActiveEdit ? 'queued' : 'ready';
  }

  async markSynced(
    expectedDraftRevision: string,
    sourceRevision: string,
  ): Promise<void> {
    this.assertNoPending();
    if (expectedDraftRevision !== this.manifest.draftRevision) {
      throw new HtmlEditingRecoveryError('同步目标 draft revision 已变化');
    }
    this.manifest = {
      ...this.manifest,
      sourceRevision,
      syncedDraftRevision: expectedDraftRevision,
      syncRequested: false,
      conflict: undefined,
    };
    await this.files.writeManifest(this.manifest);
  }

  async markRecoveryConflict(): Promise<void> {
    this.manifest = { ...this.manifest, conflict: 'RECOVERY_INCONSISTENT' };
    await this.files.writeManifest(this.manifest);
  }

  async markSourceConflict(): Promise<void> {
    this.manifest = { ...this.manifest, conflict: 'SOURCE_REVISION_MISMATCH' };
    await this.files.writeManifest(this.manifest);
  }

  async discard(): Promise<void> {
    await this.files.discard(this.manifest.projectId, this.manifest.assetId);
  }

  private assertUsable(): void {
    if (this.manifest.conflict) {
      throw new HtmlEditingRecoveryError(
        `HTML editing session 存在恢复冲突：${this.manifest.conflict}`,
      );
    }
  }

  private assertNoPending(): void {
    this.assertUsable();
    if (this.manifest.pending) {
      throw new HtmlEditingRecoveryError('Agent Turn 尚未收口');
    }
  }
}
