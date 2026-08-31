import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import type { AgentFunctionToolExecutionContext } from '../../../main/agents/function-tools/agent-function-tool';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import {
  createTextRevision,
  DefaultTextContentAdapter,
} from '../../../main/content/text-content';
import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
} from '../../../main/generation/generation-task-service';
import { AppError } from '../../../main/errors/app-error';
import type { GenerationTaskSnapshot } from '../../../main/generation/contracts/generation-task-state';
import type { WorkbenchStateDataDatabaseApi } from '../../../main/workbench/workbench-state-data-database';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { createHtmlDomTarget, type HtmlDomAnchorV1 } from '../shared';
import {
  HTML_DRAFT_HISTORY_LIMIT,
  HtmlDraftStore,
  type HtmlDraftOperation,
  type HtmlDraftSession,
} from './html-draft-store';
import type { HtmlEditToolRuntime } from './html-edit-function-tools';
import {
  beginHtmlSourceEdit,
  replaceHtmlSourceEdit,
  type BegunHtmlSourceEdit,
} from './html-source-editor';

interface ActiveHtmlEdit {
  readonly taskId: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly draftRevision: string;
  readonly edit: BegunHtmlSourceEdit;
}

export type HtmlAgentEditEvent =
  | {
      readonly type: 'started' | 'ended';
      readonly projectId: string;
      readonly assetId: string;
      readonly taskId: string;
      readonly editId: string;
      readonly target: HtmlDomAnchorV1;
    }
  | {
      readonly type: 'rejected';
      readonly projectId: string;
      readonly assetId: string;
      readonly taskId: string;
      readonly editId: string;
      readonly target: HtmlDomAnchorV1;
      readonly reason: string;
    }
  | {
      readonly type: 'applied';
      readonly projectId: string;
      readonly assetId: string;
      readonly taskId: string;
      readonly editId: string;
      readonly target: HtmlDomAnchorV1;
      readonly draftRevision: string;
    }
  | {
      readonly type: 'session-changed';
      readonly projectId: string;
      readonly assetId: string;
      readonly reason:
        | 'settle'
        | 'rollback'
        | 'undo'
        | 'redo'
        | 'sync'
        | 'discard'
        | 'conflict';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class HtmlAgentEditingService implements HtmlEditToolRuntime {
  private readonly textContent = new DefaultTextContentAdapter();
  private readonly activeEdits = new Map<string, ActiveHtmlEdit>();
  private readonly sessions = new Map<string, Promise<HtmlDraftSession>>();
  private readonly sessionMutations = new Map<string, Promise<void>>();
  private readonly writableSources = new Map<string, boolean>();
  private readonly store?: HtmlDraftStore;
  private readonly lifecycleTasks = new Set<Promise<void>>();
  private readonly listeners = new Set<(event: HtmlAgentEditEvent) => void>();
  private readonly materializationRoot = join(
    tmpdir(),
    'learning-companion-html-drafts',
    randomUUID(),
  );
  private unsubscribe?: () => void;
  private shutdownTask?: Promise<void>;
  private disposed = false;

  constructor(
    private readonly assets: AssetServiceApi,
    private readonly generationTasks: Pick<GenerationTaskServiceApi, 'get'> &
      Partial<Pick<GenerationTaskServiceApi, 'subscribe'>>,
    stateDataDatabase?: WorkbenchStateDataDatabaseApi,
  ) {
    if (stateDataDatabase) {
      this.store = new HtmlDraftStore(stateDataDatabase);
    }
    this.unsubscribe = this.generationTasks.subscribe?.((event) => {
      this.acceptLifecycleEvent(event);
    });
  }

  async begin(
    request: {
      readonly locator: Parameters<typeof beginHtmlSourceEdit>[0]['locator'];
      readonly scope: 'contents' | 'element';
    },
    context: AgentFunctionToolExecutionContext,
  ): Promise<JsonValue> {
    context.signal?.throwIfAborted();
    const assetId = this.resolveTaskAsset(context);
    return this.runSessionMutation(context.projectId, assetId, () =>
      this.beginLocked(request, context, assetId),
    );
  }

  private async beginLocked(
    request: {
      readonly locator: Parameters<typeof beginHtmlSourceEdit>[0]['locator'];
      readonly scope: 'contents' | 'element';
    },
    context: AgentFunctionToolExecutionContext,
    assetId: string,
  ): Promise<JsonValue> {
    context.signal?.throwIfAborted();
    const session = await this.getSession(context.projectId, assetId);
    if (!this.isSourceWritable(context.projectId, assetId)) {
      throw new Error('当前 HTML Asset 不可写入');
    }
    if (session.pending && session.pending.taskId !== context.taskId) {
      throw new Error('上一轮 HTML 修改尚未收口');
    }
    if (
      [...this.activeEdits.values()].some(
        (active) =>
          active.projectId === context.projectId &&
          active.assetId === assetId,
      )
    ) {
      throw new Error('当前 HTML Asset 已有未完成的 begin，请先 replace');
    }
    const edit = beginHtmlSourceEdit({
      source: session.draft,
      locator: request.locator,
      scope: request.scope,
    });
    const editId = randomUUID();
    this.activeEdits.set(editId, {
      taskId: context.taskId,
      projectId: context.projectId,
      assetId,
      draftRevision: session.draftRevision,
      edit,
    });
    this.publish({
      type: 'started',
      projectId: context.projectId,
      assetId,
      taskId: context.taskId,
      editId,
      target: edit.resolvedTarget,
    });
    return {
      editId,
      scope: request.scope,
      currentHtml: edit.currentHtml,
      draftRevision: session.draftRevision,
      resolvedTarget: createHtmlDomTarget(edit.resolvedTarget).anchorPayload,
    };
  }

  async canEdit(projectId: string, assetId: string): Promise<boolean> {
    try {
      const asset = this.assets.get(assetId);
      if (
        this.assets.getActiveProjectId() !== projectId ||
        !asset ||
        asset.projectId !== projectId ||
        asset.mediaType !== 'text/html'
      ) {
        return false;
      }
      const session = await this.getSession(projectId, assetId);
      return !session.conflict && this.isSourceWritable(projectId, assetId);
    } catch {
      return false;
    }
  }

  subscribe(listener: (event: HtmlAgentEditEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async replace(
    editId: string,
    html: string,
    context: AgentFunctionToolExecutionContext,
  ): Promise<JsonValue> {
    const active = this.requireActiveEdit(editId, context);
    return this.runSessionMutation(active.projectId, active.assetId, () =>
      this.replaceLocked(editId, html, context),
    );
  }

  private async replaceLocked(
    editId: string,
    html: string,
    context: AgentFunctionToolExecutionContext,
  ): Promise<JsonValue> {
    context.signal?.throwIfAborted();
    const active = this.requireActiveEdit(editId, context);
    const session = await this.getSession(active.projectId, active.assetId);
    if (session.draftRevision !== active.draftRevision) {
      this.activeEdits.delete(editId);
      throw new Error('HTML 草稿已变化，请重新 begin');
    }
    let replaced;
    try {
      replaced = replaceHtmlSourceEdit(active.edit, html);
    } catch (error) {
      this.publish({
        type: 'rejected',
        projectId: active.projectId,
        assetId: active.assetId,
        taskId: active.taskId,
        editId,
        target: active.edit.resolvedTarget,
        reason:
          error instanceof Error && 'code' in error
            ? String(error.code)
            : 'HTML_EDIT_REJECTED',
      });
      throw error;
    }
    const beforeHtml = active.edit.currentHtml;
    const nextDraft = replaced.source;
    const nextRevision = this.revisionOf(nextDraft);
    const operation: HtmlDraftOperation = {
      rangeStart: active.edit.range.start,
      beforeHtml,
      afterHtml: html,
      beforeRevision: session.draftRevision,
      afterRevision: nextRevision,
    };
    if (session.pending && session.pending.taskId !== context.taskId) {
      throw new Error('上一轮 HTML 修改尚未收口');
    }
    const next: HtmlDraftSession = {
      ...session,
      draft: nextDraft,
      draftRevision: nextRevision,
      pending: session.pending
        ? {
            ...session.pending,
            operations: [...session.pending.operations, operation],
          }
        : {
            taskId: context.taskId,
            beforeDraft: session.draft,
            beforeRevision: session.draftRevision,
            operations: [operation],
          },
    };
    await this.persist(next);
    this.activeEdits.delete(editId);
    this.publish({
      type: 'applied',
      projectId: active.projectId,
      assetId: active.assetId,
      taskId: active.taskId,
      editId,
      target: replaced.resolvedTarget,
      draftRevision: nextRevision,
    });
    return {
      applied: true,
      draftRevision: nextRevision,
      resolvedTarget: createHtmlDomTarget(replaced.resolvedTarget).anchorPayload,
    };
  }

  private requireActiveEdit(
    editId: string,
    context: AgentFunctionToolExecutionContext,
  ): ActiveHtmlEdit {
    const active = this.activeEdits.get(editId);
    if (
      !active ||
      active.taskId !== context.taskId ||
      active.projectId !== context.projectId
    ) {
      throw new Error('editId 不属于当前任务，请重新 begin');
    }
    return active;
  }

  async review(projectId: string, assetId: string): Promise<JsonValue> {
    const session = await this.getSession(projectId, assetId);
    return {
      entries: session.history.entries
        .slice(0, session.history.cursor)
        .map((entry) => ({
        taskId: entry.taskId,
        changes: entry.operations.map((operation) => ({
          before: operation.beforeHtml,
          after: operation.afterHtml,
        })),
        })),
      pendingChanges:
        session.pending?.operations.map((operation) => ({
          before: operation.beforeHtml,
          after: operation.afterHtml,
        })) ?? [],
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLifecycleSubscription();
    this.activeEdits.clear();
    this.listeners.clear();
    void rm(this.materializationRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  shutdown(): Promise<void> {
    if (this.shutdownTask) return this.shutdownTask;
    this.stopLifecycleSubscription();
    this.shutdownTask = (async () => {
      while (true) {
        const pending = new Set([
          ...this.lifecycleTasks,
          ...this.sessionMutations.values(),
        ]);
        if (pending.size === 0) break;
        await Promise.all(pending);
      }
      await rm(this.materializationRoot, { recursive: true, force: true });
    })();
    return this.shutdownTask;
  }

  async handleTaskSnapshot(snapshot: GenerationTaskSnapshot): Promise<void> {
    for (const [editId, active] of this.activeEdits) {
      if (
        active.taskId === snapshot.id &&
        active.projectId === snapshot.projectId &&
        (snapshot.completed || snapshot.failure || snapshot.cancelledTime !== undefined)
      ) {
        this.publish({
          type: 'ended',
          projectId: active.projectId,
          assetId: active.assetId,
          taskId: active.taskId,
          editId,
          target: active.edit.resolvedTarget,
        });
        this.activeEdits.delete(editId);
      }
    }
    const loadedSessions = await Promise.all([...this.sessions.values()]);
    for (const loaded of loadedSessions) {
      if (loaded.projectId !== snapshot.projectId) continue;
      await this.runSessionMutation(loaded.projectId, loaded.assetId, async () => {
        let session = await this.getSession(loaded.projectId, loaded.assetId);
        if (session.pending?.taskId === snapshot.id && snapshot.completed) {
          session = await this.commitPending(session);
          this.publish({
            type: 'session-changed',
            projectId: session.projectId,
            assetId: session.assetId,
            reason: 'settle',
          });
        } else if (
          session.pending?.taskId === snapshot.id &&
          (snapshot.failure || snapshot.cancelledTime !== undefined)
        ) {
          session = await this.rollbackPending(session);
          this.publish({
            type: 'session-changed',
            projectId: session.projectId,
            assetId: session.assetId,
            reason: 'rollback',
          });
        }
        await this.finishQueuedSync(session);
      });
    }
  }

  async handleTaskDiscarded(snapshot: GenerationTaskSnapshot): Promise<void> {
    const projectId = snapshot.projectId;
    const taskId = snapshot.id;
    for (const [editId, active] of this.activeEdits) {
      if (active.projectId === projectId && active.taskId === taskId) {
        this.publish({
          type: 'ended',
          projectId: active.projectId,
          assetId: active.assetId,
          taskId: active.taskId,
          editId,
          target: active.edit.resolvedTarget,
        });
        this.activeEdits.delete(editId);
      }
    }
    const assetId = this.resolveSnapshotAsset(snapshot);
    if (!assetId) return;
    await this.runSessionMutation(projectId, assetId, async () => {
      let session = await this.getSession(projectId, assetId);
      if (session.pending?.taskId === taskId) {
        const clearMissingTaskConflict =
          session.conflict === 'RECOVERY_INCONSISTENT' &&
          this.isSessionIntegrityValid(session);
        session = await this.rollbackPending(
          session,
          clearMissingTaskConflict,
        );
        this.publish({
          type: 'session-changed',
          projectId: session.projectId,
          assetId: session.assetId,
          reason: 'rollback',
        });
      }
      await this.finishQueuedSync(session);
    });
  }

  async getDraft(projectId: string, assetId: string): Promise<string | undefined> {
    const session = await this.getSession(projectId, assetId);
    return this.hasDraft(session) ? session.draft : undefined;
  }

  async getDraftSnapshot(projectId: string, assetId: string) {
    const session = await this.getSession(projectId, assetId);
    return {
      ...(this.hasDraft(session) ? { content: session.draft } : {}),
      status: this.statusOf(session),
    };
  }

  async materializeReference(
    projectId: string,
    assetId: string,
  ): Promise<string> {
    return this.runSessionMutation(projectId, assetId, () =>
      this.materializeReferenceLocked(projectId, assetId),
    );
  }

  private async materializeReferenceLocked(
    projectId: string,
    assetId: string,
  ): Promise<string> {
    let session = await this.getSession(projectId, assetId);
    if (!session.conflict && !this.hasDraft(session)) {
      session = await this.refreshSourceSession(session);
    }
    const path = this.materializationPath(projectId, assetId);
    await mkdir(dirname(path), { recursive: true });
    await writeFileAtomic(path, session.draft, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return path;
  }

  async undo(projectId: string, assetId: string): Promise<JsonValue> {
    return this.runSessionMutation(projectId, assetId, () =>
      this.undoLocked(projectId, assetId),
    );
  }

  private async undoLocked(
    projectId: string,
    assetId: string,
  ): Promise<JsonValue> {
    const session = await this.getSession(projectId, assetId);
    if (session.pending || this.hasActiveEdit(projectId, assetId)) {
      throw new Error('Agent 修改尚未收口');
    }
    if (session.history.cursor === 0) throw new Error('没有可撤销的 HTML 修改');
    const entry = session.history.entries[session.history.cursor - 1]!;
    let draft = session.draft;
    let revision = session.draftRevision;
    for (const operation of [...entry.operations].reverse()) {
      if (
        operation.afterRevision !== revision ||
        draft.slice(
          operation.rangeStart,
          operation.rangeStart + operation.afterHtml.length,
        ) !== operation.afterHtml
      ) {
        throw new Error('HTML 撤销历史与当前草稿不一致');
      }
      draft =
        draft.slice(0, operation.rangeStart) +
        operation.beforeHtml +
        draft.slice(operation.rangeStart + operation.afterHtml.length);
      revision = operation.beforeRevision;
    }
    const next: HtmlDraftSession = {
      ...session,
      draft,
      draftRevision: revision,
      history: { ...session.history, cursor: session.history.cursor - 1 },
    };
    await this.persist(next);
    this.publish({ type: 'session-changed', projectId, assetId, reason: 'undo' });
    return this.statusOf(next);
  }

  async redo(projectId: string, assetId: string): Promise<JsonValue> {
    return this.runSessionMutation(projectId, assetId, () =>
      this.redoLocked(projectId, assetId),
    );
  }

  private async redoLocked(
    projectId: string,
    assetId: string,
  ): Promise<JsonValue> {
    const session = await this.getSession(projectId, assetId);
    if (session.pending || this.hasActiveEdit(projectId, assetId)) {
      throw new Error('Agent 修改尚未收口');
    }
    if (session.history.cursor >= session.history.entries.length) {
      throw new Error('没有可重做的 HTML 修改');
    }
    const entry = session.history.entries[session.history.cursor]!;
    let draft = session.draft;
    let revision = session.draftRevision;
    for (const operation of entry.operations) {
      if (
        operation.beforeRevision !== revision ||
        draft.slice(
          operation.rangeStart,
          operation.rangeStart + operation.beforeHtml.length,
        ) !== operation.beforeHtml
      ) {
        throw new Error('HTML 重做历史与当前草稿不一致');
      }
      draft =
        draft.slice(0, operation.rangeStart) +
        operation.afterHtml +
        draft.slice(operation.rangeStart + operation.beforeHtml.length);
      revision = operation.afterRevision;
    }
    const next: HtmlDraftSession = {
      ...session,
      draft,
      draftRevision: revision,
      history: { ...session.history, cursor: session.history.cursor + 1 },
    };
    await this.persist(next);
    this.publish({ type: 'session-changed', projectId, assetId, reason: 'redo' });
    return this.statusOf(next);
  }

  async requestSync(
    projectId: string,
    assetId: string,
  ): Promise<JsonValue> {
    return this.runSessionMutation(projectId, assetId, () =>
      this.requestSyncLocked(projectId, assetId),
    );
  }

  private async requestSyncLocked(
    projectId: string,
    assetId: string,
  ): Promise<JsonValue> {
    const session = await this.getSession(projectId, assetId);
    if (session.conflict) {
      throw new Error('HTML 草稿存在恢复冲突，无法同步');
    }
    if (
      !session.pending &&
      !this.hasActiveEdit(projectId, assetId) &&
      session.draftRevision === session.syncedDraftRevision &&
      !session.syncRequested
    ) {
      return { disposition: 'synced', status: this.statusOf(session) };
    }
    const requested: HtmlDraftSession = {
      ...session,
      syncRequested: true,
    };
    await this.persist(requested);
    if (requested.pending || this.hasActiveEdit(projectId, assetId)) {
      return { disposition: 'queued', status: this.statusOf(requested) };
    }
    const synced = await this.syncSession(requested);
    return { disposition: 'synced', status: this.statusOf(synced) };
  }

  async discard(projectId: string, assetId: string): Promise<JsonValue> {
    return this.runSessionMutation(projectId, assetId, () =>
      this.discardLocked(projectId, assetId),
    );
  }

  private async discardLocked(
    projectId: string,
    assetId: string,
  ): Promise<JsonValue> {
    const session = await this.getSession(projectId, assetId);
    if (session.pending || this.hasActiveEdit(projectId, assetId)) {
      throw new Error('Agent 修改尚未收口，无法放弃草稿');
    }
    const materializedPath = this.materializationPath(projectId, assetId);
    await rm(materializedPath, { force: true });
    await this.store?.delete(assetId);
    this.sessions.delete(`${projectId}\0${assetId}`);
    this.writableSources.delete(`${projectId}\0${assetId}`);
    this.publish({ type: 'session-changed', projectId, assetId, reason: 'discard' });
    return { discarded: true };
  }

  private async runSessionMutation<T>(
    projectId: string,
    assetId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = `${projectId}\0${assetId}`;
    const previous = this.sessionMutations.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const completion = result.then(
      () => undefined,
      () => undefined,
    );
    this.sessionMutations.set(key, completion);
    try {
      return await result;
    } finally {
      if (this.sessionMutations.get(key) === completion) {
        this.sessionMutations.delete(key);
      }
    }
  }

  private async getSession(
    projectId: string,
    assetId: string,
  ): Promise<HtmlDraftSession> {
    const key = `${projectId}\0${assetId}`;
    const current = this.sessions.get(key);
    if (current) return current;
    const loading = this.loadSession(projectId, assetId);
    this.sessions.set(key, loading);
    void loading.catch(() => {
      if (this.sessions.get(key) === loading) {
        this.sessions.delete(key);
        this.writableSources.delete(key);
      }
    });
    return loading;
  }

  private acceptLifecycleEvent(event: GenerationTaskServiceEvent): void {
    let operation: Promise<void> | undefined;
    if (event.type === 'task-changed' || event.type === 'task-completed') {
      operation = this.handleTaskSnapshot(event.snapshot);
    } else if (event.type === 'task-discarded') {
      operation = this.handleTaskDiscarded(event.snapshot);
    }
    if (!operation) return;
    const tracked = operation.catch((error: unknown) => {
      console.error('HTML Workbench Agent 草稿收口失败', error);
    });
    this.lifecycleTasks.add(tracked);
    void tracked.finally(() => this.lifecycleTasks.delete(tracked));
  }

  private stopLifecycleSubscription(): void {
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    unsubscribe?.();
  }

  private async loadSession(
    projectId: string,
    assetId: string,
  ): Promise<HtmlDraftSession> {
    const resolved = await this.assets.resolveContent(assetId);
    try {
      if (
        resolved.contentStatus.availability !== 'available' ||
        !resolved.handle?.readBytes
      ) {
        throw new Error('当前 HTML Asset 不可读取');
      }
      this.writableSources.set(
        `${projectId}\0${assetId}`,
        Boolean(resolved.handle.writeBytes),
      );
      const source = await this.textContent.read(resolved.handle);
      const initial: HtmlDraftSession = {
        version: 1,
        projectId,
        assetId,
        sourceRevision: source.revision,
        syncedDraftRevision: this.revisionOf(source.content),
        draftRevision: this.revisionOf(source.content),
        encoding: source.encoding,
        lineEnding: source.lineEnding,
        hasByteOrderMark: source.hasByteOrderMark,
        draft: source.content,
        history: { entries: [], cursor: 0 },
        syncRequested: false,
      };
      let restored: HtmlDraftSession | undefined;
      try {
        restored = await this.store?.load(assetId);
      } catch {
        return { ...initial, conflict: 'RECOVERY_INCONSISTENT' };
      }
      if (!restored) {
        return initial;
      }
      if (restored.projectId !== projectId) {
        throw new Error('HTML Workbench 草稿项目不匹配');
      }
      let session = restored;
      if (!this.isSessionIntegrityValid(session)) {
        session = { ...session, conflict: 'RECOVERY_INCONSISTENT' };
        await this.persist(session);
        return session;
      }
      if (session.sourceRevision !== source.revision) {
        if (
          session.syncRequested &&
          !session.pending &&
          source.content === session.draft
        ) {
          session = {
            ...session,
            sourceRevision: source.revision,
            syncedDraftRevision: session.draftRevision,
            syncRequested: false,
            conflict: undefined,
          };
          await this.persist(session);
          return session;
        }
        session = { ...session, conflict: 'SOURCE_REVISION_MISMATCH' };
        await this.persist(session);
        return session;
      }
      if (session.pending) {
        const pendingTask = this.generationTasks.get(session.pending.taskId);
        if (pendingTask?.completed) {
          session = await this.commitPending(session);
        } else if (pendingTask?.failure || pendingTask?.cancelledTime !== undefined) {
          session = await this.rollbackPending(session);
        } else if (!pendingTask) {
          session = { ...session, conflict: 'RECOVERY_INCONSISTENT' };
          await this.persist(session);
          return session;
        }
      }
      if (session.syncRequested && !session.pending && !session.conflict) {
        session = await this.syncSession(session);
      }
      return session;
    } finally {
      await resolved.handle?.close();
    }
  }

  private async persist(session: HtmlDraftSession): Promise<void> {
    if (!this.store) {
      const key = `${session.projectId}\0${session.assetId}`;
      this.sessions.set(key, Promise.resolve(session));
      return;
    }
    await this.store.save(session);
    const key = `${session.projectId}\0${session.assetId}`;
    this.sessions.set(key, Promise.resolve(session));
  }

  private async refreshSourceSession(
    session: HtmlDraftSession,
  ): Promise<HtmlDraftSession> {
    const resolved = await this.assets.resolveContent(session.assetId);
    try {
      if (
        resolved.contentStatus.availability !== 'available' ||
        !resolved.handle?.readBytes
      ) {
        throw new Error('当前 HTML Asset 不可读取');
      }
      this.writableSources.set(
        `${session.projectId}\0${session.assetId}`,
        Boolean(resolved.handle.writeBytes),
      );
      const source = await this.textContent.read(resolved.handle);
      const revision = this.revisionOf(source.content);
      const refreshed: HtmlDraftSession = {
        ...session,
        sourceRevision: source.revision,
        syncedDraftRevision: revision,
        draftRevision: revision,
        encoding: source.encoding,
        lineEnding: source.lineEnding,
        hasByteOrderMark: source.hasByteOrderMark,
        draft: source.content,
      };
      this.sessions.set(
        `${session.projectId}\0${session.assetId}`,
        Promise.resolve(refreshed),
      );
      return refreshed;
    } finally {
      await resolved.handle?.close();
    }
  }

  private async commitPending(
    session: HtmlDraftSession,
  ): Promise<HtmlDraftSession> {
    const pending = session.pending;
    if (!pending) return session;
    const entries = [
      ...session.history.entries.slice(0, session.history.cursor),
      { taskId: pending.taskId, operations: pending.operations },
    ].slice(-HTML_DRAFT_HISTORY_LIMIT);
    const next: HtmlDraftSession = {
      ...session,
      history: { entries, cursor: entries.length },
      pending: undefined,
    };
    await this.persist(next);
    return next;
  }

  private async rollbackPending(
    session: HtmlDraftSession,
    clearRecoveryConflict = false,
  ): Promise<HtmlDraftSession> {
    const pending = session.pending;
    if (!pending) return session;
    const next: HtmlDraftSession = {
      ...session,
      draft: pending.beforeDraft,
      draftRevision: pending.beforeRevision,
      pending: undefined,
      conflict:
        clearRecoveryConflict && session.conflict === 'RECOVERY_INCONSISTENT'
          ? undefined
          : session.conflict,
    };
    await this.persist(next);
    return next;
  }

  private async finishQueuedSync(session: HtmlDraftSession): Promise<void> {
    if (
      session.syncRequested &&
      !session.pending &&
      !session.conflict &&
      !this.hasActiveEdit(session.projectId, session.assetId)
    ) {
      await this.syncSession(session);
    }
  }

  private async syncSession(
    session: HtmlDraftSession,
  ): Promise<HtmlDraftSession> {
    const resolved = await this.assets.resolveContent(session.assetId);
    try {
      if (
        resolved.contentStatus.availability !== 'available' ||
        !resolved.handle?.readBytes ||
        !resolved.handle.writeBytes
      ) {
        throw new Error('当前 HTML 原件不可写入');
      }
      const current = await this.textContent.read(resolved.handle, {
        encoding: session.encoding,
      });
      if (current.revision !== session.sourceRevision) {
        if (session.syncRequested && current.content === session.draft) {
          return this.completeSync(session, current.revision);
        }
        const conflict: HtmlDraftSession = {
          ...session,
          conflict: 'SOURCE_REVISION_MISMATCH',
        };
        await this.persist(conflict);
        this.publish({
          type: 'session-changed',
          projectId: session.projectId,
          assetId: session.assetId,
          reason: 'conflict',
        });
        throw new AppError('CONTENT_CHANGED_EXTERNALLY');
      }
      const result = await this.textContent.write(resolved.handle, {
        content: session.draft,
        encoding: session.encoding,
        lineEnding: session.lineEnding,
        hasByteOrderMark: session.hasByteOrderMark,
        expectedRevision: session.sourceRevision,
      });
      return this.completeSync(session, result.revision);
    } finally {
      await resolved.handle?.close();
    }
  }

  private async completeSync(
    session: HtmlDraftSession,
    sourceRevision: string,
  ): Promise<HtmlDraftSession> {
    const synced: HtmlDraftSession = {
        ...session,
        sourceRevision,
        syncedDraftRevision: session.draftRevision,
        syncRequested: false,
        conflict: undefined,
      };
    await this.persist(synced);
    this.publish({
      type: 'session-changed',
      projectId: synced.projectId,
      assetId: synced.assetId,
      reason: 'sync',
    });
    return synced;
  }

  private hasActiveEdit(projectId: string, assetId: string): boolean {
    return [...this.activeEdits.values()].some(
      (active) =>
        active.projectId === projectId && active.assetId === assetId,
    );
  }

  private isSourceWritable(projectId: string, assetId: string): boolean {
    return this.writableSources.get(`${projectId}\0${assetId}`) === true;
  }

  private statusOf(session: HtmlDraftSession): JsonValue {
    const applied = session.history.entries.slice(0, session.history.cursor);
    return {
      editable:
        !session.conflict &&
        this.isSourceWritable(session.projectId, session.assetId),
      hasDraft: this.hasDraft(session),
      unsynced: session.draftRevision !== session.syncedDraftRevision,
      syncRequested: session.syncRequested,
      pending: Boolean(session.pending),
      stepCount: applied.length,
      changeCount:
        applied.reduce((total, entry) => total + entry.operations.length, 0) +
        (session.pending?.operations.length ?? 0),
      canUndo: !session.pending && session.history.cursor > 0,
      canRedo:
        !session.pending &&
        session.history.cursor < session.history.entries.length,
      conflict: session.conflict ?? null,
      draftRevision: session.draftRevision,
    };
  }

  private hasDraft(session: HtmlDraftSession): boolean {
    return (
      Boolean(session.conflict) ||
      Boolean(session.pending) ||
      session.history.entries.length > 0 ||
      session.draftRevision !== session.syncedDraftRevision
    );
  }

  private publish(event: HtmlAgentEditEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private revisionOf(content: string): string {
    return createTextRevision(new TextEncoder().encode(content));
  }

  private isSessionIntegrityValid(session: HtmlDraftSession): boolean {
    if (this.revisionOf(session.draft) !== session.draftRevision) {
      return false;
    }

    const reverse = (
      inputDraft: string,
      inputRevision: string,
      operations: readonly HtmlDraftOperation[],
    ): { readonly draft: string; readonly revision: string } | undefined => {
      let draft = inputDraft;
      let revision = inputRevision;
      for (const operation of [...operations].reverse()) {
        if (
          operation.afterRevision !== revision ||
          draft.slice(
            operation.rangeStart,
            operation.rangeStart + operation.afterHtml.length,
          ) !== operation.afterHtml
        ) {
          return undefined;
        }
        draft =
          draft.slice(0, operation.rangeStart) +
          operation.beforeHtml +
          draft.slice(operation.rangeStart + operation.afterHtml.length);
        revision = operation.beforeRevision;
      }
      return { draft, revision };
    };
    const forward = (
      inputDraft: string,
      inputRevision: string,
      operations: readonly HtmlDraftOperation[],
    ): { readonly draft: string; readonly revision: string } | undefined => {
      let draft = inputDraft;
      let revision = inputRevision;
      for (const operation of operations) {
        if (
          operation.beforeRevision !== revision ||
          draft.slice(
            operation.rangeStart,
            operation.rangeStart + operation.beforeHtml.length,
          ) !== operation.beforeHtml
        ) {
          return undefined;
        }
        draft =
          draft.slice(0, operation.rangeStart) +
          operation.afterHtml +
          draft.slice(operation.rangeStart + operation.beforeHtml.length);
        revision = operation.afterRevision;
      }
      return { draft, revision };
    };

    const pending = session.pending;
    let cursorDraft = session.draft;
    let cursorRevision = session.draftRevision;
    if (pending) {
      const beforePending = reverse(
        cursorDraft,
        cursorRevision,
        pending.operations,
      );
      if (
        !beforePending ||
        beforePending.draft !== pending.beforeDraft ||
        beforePending.revision !== pending.beforeRevision ||
        this.revisionOf(beforePending.draft) !== beforePending.revision
      ) {
        return false;
      }
      cursorDraft = beforePending.draft;
      cursorRevision = beforePending.revision;
    }

    let baseline = { draft: cursorDraft, revision: cursorRevision };
    for (let index = session.history.cursor - 1; index >= 0; index -= 1) {
      const previous = reverse(
        baseline.draft,
        baseline.revision,
        session.history.entries[index]!.operations,
      );
      if (
        !previous ||
        this.revisionOf(previous.draft) !== previous.revision
      ) {
        return false;
      }
      baseline = previous;
    }

    let replayed = baseline;
    if (
      session.history.cursor === 0 &&
      (replayed.draft !== cursorDraft || replayed.revision !== cursorRevision)
    ) {
      return false;
    }
    for (let index = 0; index < session.history.entries.length; index += 1) {
      const next = forward(
        replayed.draft,
        replayed.revision,
        session.history.entries[index]!.operations,
      );
      if (!next || this.revisionOf(next.draft) !== next.revision) return false;
      replayed = next;
      if (
        index + 1 === session.history.cursor &&
        (replayed.draft !== cursorDraft || replayed.revision !== cursorRevision)
      ) {
        return false;
      }
    }
    return true;
  }

  private materializationPath(projectId: string, assetId: string): string {
    const digest = createHash('sha256')
      .update(JSON.stringify([projectId, assetId]))
      .digest('hex');
    return join(this.materializationRoot, `${digest}.html`);
  }

  private resolveTaskAsset(
    context: AgentFunctionToolExecutionContext,
  ): string {
    const snapshot = this.generationTasks.get(context.taskId);
    const assetId = snapshot
      ? this.resolveSnapshotAsset(snapshot)
      : undefined;

    if (
      !snapshot ||
      snapshot.projectId !== context.projectId ||
      this.assets.getActiveProjectId() !== context.projectId ||
      !assetId
    ) {
      throw new Error('当前任务没有唯一有效的 HTML Asset');
    }
    return assetId;
  }

  private resolveSnapshotAsset(
    snapshot: GenerationTaskSnapshot,
  ): string | undefined {
    const instruction = snapshot.instruction;
    const assetId = isRecord(instruction) ? instruction.assetId : undefined;
    const references = snapshot.prepared?.assetReferences.source ?? [];
    const reference = references[0];
    const asset = typeof assetId === 'string' ? this.assets.get(assetId) : undefined;

    if (
      typeof assetId !== 'string' ||
      references.length !== 1 ||
      reference?.assetId !== assetId ||
      reference.mediaType !== 'text/html' ||
      (reference.materializedMediaType !== undefined &&
        reference.materializedMediaType !== 'text/html') ||
      !asset ||
      asset.projectId !== snapshot.projectId ||
      asset.mediaType !== 'text/html'
    ) {
      return undefined;
    }
    return assetId;
  }
}
