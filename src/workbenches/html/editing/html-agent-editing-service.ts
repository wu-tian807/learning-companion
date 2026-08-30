import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { AgentFunctionToolExecutionContext } from '../../../main/agents/function-tools/agent-function-tool';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import type { GenerationTaskServiceApi } from '../../../main/generation/generation-task-service';
import type { GenerationTaskSnapshot } from '../../../main/generation/generation-task';
import { DefaultTextContentAdapter } from '../../../main/content/text-content';
import { AppError } from '../../../main/errors/app-error';
import { createHtmlDomTarget, type HtmlDomAnchorV1 } from '../shared';
import {
  HtmlEditError,
  type HtmlEditLocator,
  type HtmlEditScope,
} from './html-document-parser';
import type { HtmlEditExecutionIdentity } from './html-edit-history';
import { HtmlEditingRecoveryError, HtmlEditingSessionFile } from './html-editing-session-file';
import { HtmlEditingSession } from './html-editing-session';
import {
  beginHtmlSourceEdit,
  replaceHtmlSourceEdit,
  type BegunHtmlSourceEdit,
} from './html-source-editor';

export type HtmlAgentEditEvent =
  | {
      readonly type: 'started';
      readonly projectId: string;
      readonly assetId: string;
      readonly editId: string;
      readonly executionId: string;
      readonly target: HtmlDomAnchorV1;
    }
  | {
      readonly type: 'applied';
      readonly projectId: string;
      readonly assetId: string;
      readonly editId: string;
      readonly executionId: string;
      readonly draftRevision: string;
      readonly target: HtmlDomAnchorV1;
    }
  | {
      readonly type: 'rejected';
      readonly projectId: string;
      readonly assetId: string;
      readonly editId: string;
      readonly executionId: string;
      readonly target: HtmlDomAnchorV1;
      readonly reason: string;
    }
  | {
      readonly type: 'ended';
      readonly projectId: string;
      readonly assetId: string;
      readonly editId: string;
      readonly executionId: string;
      readonly target: HtmlDomAnchorV1;
    }
  | {
      readonly type: 'session-changed';
      readonly projectId: string;
      readonly assetId: string;
      readonly reason:
        | 'undo'
        | 'redo'
        | 'sync'
        | 'discard'
        | 'rollback'
        | 'conflict';
    };

export interface HtmlBeginEditRequest {
  readonly locator: HtmlEditLocator;
  readonly scope: HtmlEditScope;
}

export interface HtmlBeginEditResult {
  readonly editId: string;
  readonly draftRevision: string;
  readonly scope: HtmlEditScope;
  readonly resolvedTarget: ReturnType<typeof createHtmlDomTarget>;
  readonly currentHtml: string;
}

export interface HtmlReplaceEditResult {
  readonly applied: true;
  readonly draftRevision: string;
  readonly resolvedTarget: ReturnType<typeof createHtmlDomTarget>;
}

interface ActiveHtmlEdit {
  readonly editId: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly identity: HtmlEditExecutionIdentity;
  readonly draftRevision: string;
  readonly edit: BegunHtmlSourceEdit;
}

function identityOf(
  context: AgentFunctionToolExecutionContext,
): HtmlEditExecutionIdentity {
  return {
    taskId: context.taskId,
    callKey: context.callKey,
    executionId: context.executionId,
  };
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

export class HtmlAgentEditingService {
  private readonly files: HtmlEditingSessionFile;
  private readonly textContent = new DefaultTextContentAdapter();
  private readonly sessions = new Map<
    string,
    Promise<HtmlEditingSession | undefined>
  >();
  private readonly activeEdits = new Map<string, ActiveHtmlEdit>();
  private readonly activeEditByExecution = new Map<string, string>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly listeners = new Set<(event: HtmlAgentEditEvent) => void>();
  private generationTasks: Pick<GenerationTaskServiceApi, 'get'> | undefined;
  private disposed = false;

  constructor(
    recoveryRoot: string,
    private readonly assets: AssetServiceApi,
  ) {
    this.files = new HtmlEditingSessionFile(recoveryRoot);
  }

  subscribe(listener: (event: HtmlAgentEditEvent) => void): () => void {
    this.assertReady();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  attachGenerationTasks(tasks: Pick<GenerationTaskServiceApi, 'get'>): void {
    this.assertReady();
    this.generationTasks = tasks;
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
      await this.assertAssetWritable(assetId);
      const session = await this.findSession(projectId, assetId);
      return !session?.getManifest().conflict;
    } catch {
      return false;
    }
  }

  async begin(
    request: HtmlBeginEditRequest,
    context: AgentFunctionToolExecutionContext,
  ): Promise<HtmlBeginEditResult> {
    const binding = this.requireBinding(context);
    return this.enqueue(binding.assetId, async () => {
      this.assertReady();
      context.signal?.throwIfAborted();
      const executionKey = this.executionKey(context);
      this.clearSupersededActiveEdit(
        context.projectId,
        binding.assetId,
        identityOf(context),
      );
      if (this.activeEditByExecution.has(executionKey)) {
        throw new HtmlEditingRecoveryError(
          '当前 Agent execution 已有未完成的 HTML edit，请先 replace',
        );
      }
      await this.assertAssetWritable(binding.assetId);
      const session = await this.requireSession(context.projectId, binding.assetId);
      let manifest = session.getManifest();
      if (manifest.pending && !sameIdentity(manifest.pending, identityOf(context))) {
        if (
          manifest.pending.taskId === context.taskId &&
          manifest.pending.callKey === context.callKey
        ) {
          await this.rollbackPending(session, manifest.pending);
          manifest = session.getManifest();
        } else {
          throw new HtmlEditingRecoveryError('另一个 Agent Turn 仍有待收口修改');
        }
      }
      const edit = beginHtmlSourceEdit({
        source: session.getDraft(),
        locator: request.locator,
        scope: request.scope,
      });
      const editId = randomUUID();
      const active: ActiveHtmlEdit = {
        editId,
        projectId: context.projectId,
        assetId: binding.assetId,
        identity: identityOf(context),
        draftRevision: manifest.draftRevision,
        edit,
      };
      this.activeEdits.set(editId, active);
      this.activeEditByExecution.set(executionKey, editId);
      this.publish({
        type: 'started',
        projectId: context.projectId,
        assetId: binding.assetId,
        editId,
        executionId: context.executionId,
        target: edit.resolvedTarget,
      });
      return {
        editId,
        draftRevision: manifest.draftRevision,
        scope: request.scope,
        resolvedTarget: createHtmlDomTarget(edit.resolvedTarget),
        currentHtml: edit.currentHtml,
      };
    });
  }

  async replace(
    editId: string,
    html: string,
    context: AgentFunctionToolExecutionContext,
  ): Promise<HtmlReplaceEditResult> {
    const binding = this.requireBinding(context);
    return this.enqueue(binding.assetId, async () => {
      this.assertReady();
      context.signal?.throwIfAborted();
      const active = this.activeEdits.get(editId);
      if (
        !active ||
        active.projectId !== context.projectId ||
        active.assetId !== binding.assetId ||
        !sameIdentity(active.identity, identityOf(context))
      ) {
        throw new HtmlEditingRecoveryError(
          'editId 不属于当前 Agent execution，请重新 begin',
        );
      }
      const session = await this.requireSession(context.projectId, binding.assetId);
      if (session.getManifest().draftRevision !== active.draftRevision) {
        this.consume(active, context);
        this.publishEnded(active);
        throw new HtmlEditingRecoveryError('HTML draft 已变化，请重新 begin');
      }

      let replaced;
      try {
        replaced = replaceHtmlSourceEdit({ edit: active.edit, replacement: html });
      } catch (error) {
        if (error instanceof HtmlEditError) {
          this.publish({
            type: 'rejected',
            projectId: active.projectId,
            assetId: active.assetId,
            editId,
            executionId: active.identity.executionId,
            target: active.edit.resolvedTarget,
            reason: error.code,
          });
        }
        throw error;
      }

      await session.applyOperation({
        identity: active.identity,
        rangeStart: active.edit.range.start,
        beforeHtml: active.edit.currentHtml,
        afterHtml: html,
        beforeTarget: active.edit.resolvedTarget,
        afterTarget: replaced.resolvedTarget,
        nextDraft: replaced.source,
      });
      this.consume(active, context);
      const draftRevision = session.getManifest().draftRevision;
      this.publish({
        type: 'applied',
        projectId: active.projectId,
        assetId: active.assetId,
        editId,
        executionId: active.identity.executionId,
        draftRevision,
        target: replaced.resolvedTarget,
      });
      return {
        applied: true,
        draftRevision,
        resolvedTarget: createHtmlDomTarget(replaced.resolvedTarget),
      };
    });
  }

  async settle(
    projectId: string,
    assetId: string,
    identity: HtmlEditExecutionIdentity,
  ): Promise<boolean> {
    return this.enqueue(assetId, async () => {
      const session = await this.requireSession(projectId, assetId);
      this.clearActiveIdentity(projectId, assetId, identity);
      const settled = await session.settle(identity);
      if (settled && session.getManifest().syncRequested) {
        await this.syncSession(session);
      }
      return settled;
    });
  }

  async rollback(
    projectId: string,
    assetId: string,
    identity: HtmlEditExecutionIdentity,
  ): Promise<boolean> {
    return this.enqueue(assetId, async () => {
      const session = await this.requireSession(projectId, assetId);
      this.clearActiveIdentity(projectId, assetId, identity);
      const rolledBack = await session.rollback(identity);
      if (rolledBack) {
        this.publish({
          type: 'session-changed',
          projectId,
          assetId,
          reason: 'rollback',
        });
        if (session.getManifest().syncRequested) {
          await this.syncSession(session);
        }
      }
      return rolledBack;
    });
  }

  async handleTaskSnapshot(snapshot: GenerationTaskSnapshot): Promise<void> {
    this.clearActiveTask(snapshot.projectId, snapshot.id);
    const sessions = await this.knownSessions();
    for (const session of sessions) {
      const manifest = session.getManifest();
      const pending = manifest.pending;
      if (
        pending?.taskId === snapshot.id &&
        manifest.projectId === snapshot.projectId
      ) {
        await this.enqueue(manifest.assetId, () =>
          this.reconcileSession(session, snapshot),
        );
      } else {
        await this.enqueue(manifest.assetId, () =>
          this.finishQueuedSyncIfStable(session),
        );
      }
    }
  }

  async handleTaskDiscarded(projectId: string, taskId: string): Promise<void> {
    this.clearActiveTask(projectId, taskId);
    const sessions = await this.knownSessions();
    for (const session of sessions) {
      const manifest = session.getManifest();
      const pending = manifest.pending;
      if (
        pending?.taskId === taskId &&
        manifest.projectId === projectId
      ) {
        await this.enqueue(manifest.assetId, () =>
          this.rollbackPending(session, pending),
        );
      } else {
        await this.enqueue(manifest.assetId, () =>
          this.finishQueuedSyncIfStable(session),
        );
      }
    }
  }

  async getDraft(projectId: string, assetId: string): Promise<string | undefined> {
    return (await this.findSession(projectId, assetId))?.getDraft();
  }

  async getDraftSnapshot(projectId: string, assetId: string) {
    const session = await this.findSession(projectId, assetId);
    if (!session) return undefined;
    return {
      content: session.getDraft(),
      absolutePath: join(
        this.files.directory(projectId, assetId),
        'draft.html',
      ),
      status: this.statusOf(session),
    };
  }

  async undo(projectId: string, assetId: string) {
    return this.enqueue(assetId, async () => {
      const session = await this.requireExistingSession(projectId, assetId);
      await session.undo();
      this.publish({ type: 'session-changed', projectId, assetId, reason: 'undo' });
      return this.statusOf(session);
    });
  }

  async redo(projectId: string, assetId: string) {
    return this.enqueue(assetId, async () => {
      const session = await this.requireExistingSession(projectId, assetId);
      await session.redo();
      this.publish({ type: 'session-changed', projectId, assetId, reason: 'redo' });
      return this.statusOf(session);
    });
  }

  async requestSync(projectId: string, assetId: string) {
    return this.enqueue(assetId, async () => {
      const session = await this.requireExistingSession(projectId, assetId);
      const disposition = await session.requestSync(
        this.hasActiveEdit(projectId, assetId),
      );
      if (disposition === 'ready') {
        await this.syncSession(session);
        this.publish({ type: 'session-changed', projectId, assetId, reason: 'sync' });
      }
      return { disposition, status: this.statusOf(session) };
    });
  }

  async discard(projectId: string, assetId: string) {
    return this.enqueue(assetId, async () => {
      const key = `${projectId}\0${assetId}`;
      const session = await this.requireExistingSession(projectId, assetId);
      if (session.getManifest().pending) {
        throw new HtmlEditingRecoveryError('Agent Turn 尚未收口');
      }
      await session.discard();
      this.sessions.delete(key);
      this.publish({ type: 'session-changed', projectId, assetId, reason: 'discard' });
      return { discarded: true as const };
    });
  }

  async review(projectId: string, assetId: string) {
    const session = await this.requireExistingSession(projectId, assetId);
    const manifest = session.getManifest();
    return {
      entries: manifest.history.entries.map((entry) => ({
        executionId: entry.executionId,
        changes: entry.operations.map((operation) => ({
          before: operation.beforeHtml,
          after: operation.afterHtml,
        })),
      })),
      pendingChanges: manifest.pending?.operations.map((operation) => ({
        before: operation.beforeHtml,
        after: operation.afterHtml,
      })) ?? [],
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.activeEdits.clear();
    this.activeEditByExecution.clear();
    this.sessions.clear();
  }

  private requireBinding(context: AgentFunctionToolExecutionContext) {
    const references = context.assetReferences.source ?? [];
    if (
      references.length !== 1 ||
      references[0].mediaType !== 'text/html' ||
      (references[0].materializedMediaType !== undefined &&
        references[0].materializedMediaType !== 'text/html')
    ) {
      throw new HtmlEditingRecoveryError(
        '当前任务必须提供唯一的 HTML source AssetReference',
      );
    }
    const asset = this.assets.get(references[0].assetId);
    if (
      this.assets.getActiveProjectId() !== context.projectId ||
      !asset ||
      asset.projectId !== context.projectId ||
      asset.mediaType !== 'text/html'
    ) {
      throw new HtmlEditingRecoveryError('HTML source AssetReference 已失效');
    }
    return references[0];
  }

  private async requireSession(
    projectId: string,
    assetId: string,
  ): Promise<HtmlEditingSession> {
    const key = `${projectId}\0${assetId}`;
    const current = this.sessions.get(key);
    if (current) {
      const opened = await current;
      if (opened) return opened;
    }

    const creation = this.openSession(projectId, assetId, true);
    this.sessions.set(key, creation);
    void creation.catch(() => {
      if (this.sessions.get(key) === creation) this.sessions.delete(key);
    });
    const opened = await creation;
    if (!opened) {
      this.sessions.delete(key);
      throw new HtmlEditingRecoveryError('HTML editing session 创建失败');
    }
    return opened;
  }

  private async findSession(
    projectId: string,
    assetId: string,
  ): Promise<HtmlEditingSession | undefined> {
    const key = `${projectId}\0${assetId}`;
    const current = this.sessions.get(key);
    if (current) return current;

    const loading = this.openSession(projectId, assetId, false);
    this.sessions.set(key, loading);
    void loading.catch(() => {
      if (this.sessions.get(key) === loading) this.sessions.delete(key);
    });
    const opened = await loading;
    if (!opened) return undefined;
    return opened;
  }

  private async requireExistingSession(
    projectId: string,
    assetId: string,
  ): Promise<HtmlEditingSession> {
    const session = await this.findSession(projectId, assetId);
    if (!session) {
      throw new HtmlEditingRecoveryError('当前 HTML 没有 Agent 草稿');
    }
    return session;
  }

  private async knownSessions(): Promise<readonly HtmlEditingSession[]> {
    return (await Promise.all([...this.sessions.values()])).filter(
      (session): session is HtmlEditingSession => session !== undefined,
    );
  }

  private statusOf(session: HtmlEditingSession) {
    const manifest = session.getManifest();
    const appliedEntries = manifest.history.entries.slice(
      0,
      manifest.history.cursor,
    );
    return {
      editable: !manifest.conflict,
      hasDraft: true,
      unsynced: manifest.draftRevision !== manifest.syncedDraftRevision,
      syncRequested: manifest.syncRequested,
      pending: Boolean(manifest.pending),
      stepCount: appliedEntries.length,
      changeCount:
        appliedEntries.reduce(
          (total, entry) => total + entry.operations.length,
          0,
        ) + (manifest.pending?.operations.length ?? 0),
      canUndo: !manifest.pending && manifest.history.cursor > 0,
      canRedo:
        !manifest.pending &&
        manifest.history.cursor < manifest.history.entries.length,
      conflict: manifest.conflict ?? null,
      draftRevision: manifest.draftRevision,
    };
  }

  private async syncSession(session: HtmlEditingSession): Promise<void> {
    const manifest = session.getManifest();
    if (
      manifest.pending ||
      this.hasActiveEdit(manifest.projectId, manifest.assetId)
    ) {
      return;
    }
    const resolved = await this.assets.resolveContent(manifest.assetId);
    try {
      const handle = resolved.handle;
      if (!handle?.readBytes || !handle.writeBytes) {
        throw new AppError('CONTENT_WRITE_FAILED');
      }
      const current = await this.textContent.read(handle, {
        encoding: manifest.encoding,
      });
      if (current.revision !== manifest.sourceRevision) {
        await session.markSourceConflict();
        this.publish({
          type: 'session-changed',
          projectId: manifest.projectId,
          assetId: manifest.assetId,
          reason: 'conflict',
        });
        throw new AppError('CONTENT_CHANGED_EXTERNALLY');
      }
      const result = await this.textContent.write(handle, {
        content: session.getDraft(),
        encoding: manifest.encoding,
        lineEnding: manifest.lineEnding,
        hasByteOrderMark: manifest.hasByteOrderMark,
        expectedRevision: manifest.sourceRevision,
      });
      await session.markSynced(manifest.draftRevision, result.revision);
    } finally {
      await resolved.handle?.close();
    }
  }

  private async openSession(
    projectId: string,
    assetId: string,
    createIfMissing: boolean,
  ): Promise<HtmlEditingSession | undefined> {
    if (!createIfMissing) {
      const existing = await HtmlEditingSession.openExisting(
        this.files,
        projectId,
        assetId,
      );
      if (!existing) return undefined;
    }
    const resolved = await this.assets.resolveContent(assetId);
    try {
      const handle = resolved.handle;
      if (
        resolved.contentStatus.availability !== 'available' ||
        !handle?.readBytes
      ) {
        if (!createIfMissing) {
          const session = await HtmlEditingSession.openExisting(
            this.files,
            projectId,
            assetId,
          );
          if (session) await this.auditRecoveredSession(session);
          return session;
        }
        throw new HtmlEditingRecoveryError('HTML Asset 当前不可读');
      }
      const source = await this.textContent.read(handle);
      const session = createIfMissing
        ? await HtmlEditingSession.openOrCreate(
            this.files,
            projectId,
            assetId,
            source,
          )
        : await HtmlEditingSession.openExisting(
            this.files,
            projectId,
            assetId,
            source.revision,
            source.content,
          );
      if (session) {
        await this.auditRecoveredSession(session);
        await this.finishQueuedSyncIfStable(session);
      }
      return session;
    } finally {
      await resolved.handle?.close();
    }
  }

  private async assertAssetWritable(assetId: string): Promise<void> {
    const resolved = await this.assets.resolveContent(assetId);
    try {
      if (
        resolved.contentStatus.availability !== 'available' ||
        !resolved.handle?.readBytes ||
        !resolved.handle.writeBytes
      ) {
        throw new HtmlEditingRecoveryError('HTML Asset 当前不可读写');
      }
    } finally {
      await resolved.handle?.close();
    }
  }

  private async auditRecoveredSession(session: HtmlEditingSession): Promise<void> {
    const pending = session.getManifest().pending;
    if (!pending || !this.generationTasks) return;

    let snapshot: GenerationTaskSnapshot | undefined;
    try {
      snapshot = this.generationTasks.get(pending.taskId);
    } catch {
      await session.markRecoveryConflict();
      return;
    }
    if (!snapshot) {
      await session.markRecoveryConflict();
      return;
    }
    await this.reconcileSession(session, snapshot);
  }

  private async reconcileSession(
    session: HtmlEditingSession,
    snapshot: GenerationTaskSnapshot,
  ): Promise<void> {
    const manifest = session.getManifest();
    const pending = manifest.pending;
    if (
      !pending ||
      pending.taskId !== snapshot.id ||
      manifest.projectId !== snapshot.projectId
    ) {
      return;
    }

    if (snapshot.failure || snapshot.cancelledTime !== undefined) {
      await this.rollbackPending(session, pending);
      return;
    }

    const call = snapshot.agentCalls.find(
      (candidate) => candidate.callKey === pending.callKey,
    );
    if (!snapshot.completed) {
      if (!call) return;
      if (
        call.providerExecutionId &&
        call.providerExecutionId !== pending.executionId
      ) {
        await this.rollbackPending(session, pending);
      } else if (!call.providerExecutionId) {
        await session.markRecoveryConflict();
      }
      return;
    }

    if (
      !call?.providerExecutionId ||
      call.providerExecutionId !== pending.executionId
    ) {
      await session.markRecoveryConflict();
      return;
    }
    const settled = await session.settle(pending);
    this.clearActiveIdentity(manifest.projectId, manifest.assetId, pending);
    if (settled && session.getManifest().syncRequested) {
      await this.syncSession(session);
      this.publish({
        type: 'session-changed',
        projectId: manifest.projectId,
        assetId: manifest.assetId,
        reason: 'sync',
      });
    }
  }

  private async rollbackPending(
    session: HtmlEditingSession,
    pending: HtmlEditExecutionIdentity,
  ): Promise<boolean> {
    const manifest = session.getManifest();
    const rolledBack = await session.rollback(pending);
    this.clearActiveIdentity(manifest.projectId, manifest.assetId, pending);
    if (!rolledBack) return false;

    this.publish({
      type: 'session-changed',
      projectId: manifest.projectId,
      assetId: manifest.assetId,
      reason: 'rollback',
    });
    if (session.getManifest().syncRequested) {
      await this.syncSession(session);
      this.publish({
        type: 'session-changed',
        projectId: manifest.projectId,
        assetId: manifest.assetId,
        reason: 'sync',
      });
    }
    return true;
  }

  private async finishQueuedSyncIfStable(
    session: HtmlEditingSession,
  ): Promise<void> {
    const manifest = session.getManifest();
    if (
      !manifest.syncRequested ||
      manifest.pending ||
      manifest.conflict ||
      this.hasActiveEdit(manifest.projectId, manifest.assetId)
    ) {
      return;
    }
    await this.syncSession(session);
    this.publish({
      type: 'session-changed',
      projectId: manifest.projectId,
      assetId: manifest.assetId,
      reason: 'sync',
    });
  }

  private hasActiveEdit(projectId: string, assetId: string): boolean {
    return [...this.activeEdits.values()].some(
      (active) =>
        active.projectId === projectId && active.assetId === assetId,
    );
  }

  private executionKey(context: AgentFunctionToolExecutionContext): string {
    return `${context.projectId}\0${context.taskId}\0${context.callKey}\0${context.executionId}`;
  }

  private consume(active: ActiveHtmlEdit, context: AgentFunctionToolExecutionContext): void {
    this.activeEdits.delete(active.editId);
    this.activeEditByExecution.delete(this.executionKey(context));
  }

  private clearActiveIdentity(
    projectId: string,
    assetId: string,
    identity: HtmlEditExecutionIdentity,
  ): void {
    for (const active of this.activeEdits.values()) {
      if (
        active.projectId === projectId &&
        active.assetId === assetId &&
        sameIdentity(active.identity, identity)
      ) {
        this.activeEdits.delete(active.editId);
      }
    }
    this.activeEditByExecution.delete(
      `${projectId}\0${identity.taskId}\0${identity.callKey}\0${identity.executionId}`,
    );
  }

  private clearActiveTask(projectId: string, taskId: string): void {
    for (const active of [...this.activeEdits.values()]) {
      if (
        active.projectId === projectId &&
        active.identity.taskId === taskId
      ) {
        this.activeEdits.delete(active.editId);
        this.activeEditByExecution.delete(
          `${projectId}\0${active.identity.taskId}\0${active.identity.callKey}\0${active.identity.executionId}`,
        );
        this.publishEnded(active);
      }
    }
  }

  private clearSupersededActiveEdit(
    projectId: string,
    assetId: string,
    identity: HtmlEditExecutionIdentity,
  ): void {
    for (const active of [...this.activeEdits.values()]) {
      if (
        active.projectId === projectId &&
        active.assetId === assetId &&
        active.identity.taskId === identity.taskId &&
        active.identity.callKey === identity.callKey &&
        active.identity.executionId !== identity.executionId
      ) {
        this.activeEdits.delete(active.editId);
        this.activeEditByExecution.delete(
          `${projectId}\0${active.identity.taskId}\0${active.identity.callKey}\0${active.identity.executionId}`,
        );
        this.publishEnded(active);
      }
    }
  }

  private publishEnded(active: ActiveHtmlEdit): void {
    this.publish({
      type: 'ended',
      projectId: active.projectId,
      assetId: active.assetId,
      editId: active.editId,
      executionId: active.identity.executionId,
      target: active.edit.resolvedTarget,
    });
  }

  private enqueue<T>(assetId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(assetId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(assetId, tail);
    void tail.finally(() => {
      if (this.queues.get(assetId) === tail) this.queues.delete(assetId);
    });
    return result;
  }

  private publish(event: HtmlAgentEditEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private assertReady(): void {
    if (this.disposed) {
      throw new HtmlEditingRecoveryError('HTML editing service 已停止');
    }
  }
}
