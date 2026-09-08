import { randomUUID } from 'node:crypto';

import type {
  WorkbenchBootstrap,
  WorkbenchCommand,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import type { AssetServiceApi } from '../assets/asset-service';
import type { AttachmentServiceApi } from '../attachments/attachment-service';
import { AppError } from '../errors/app-error';
import type {
  AssetWorkbenchSession,
  WorkbenchProviderContext,
} from './workbench-session';
import { toWorkbenchProviderContext } from './workbench-session';
import type { WorkbenchRegistry } from './workbench-registry';
import type { WorkbenchTransportBindingRegistryApi } from './interaction/workbench-transport-binding-registry';
import type { WorkbenchStateDatabaseApi } from './workbench-state-database';

export interface WorkbenchSessionLifecycle {
  closeActive(): Promise<void>;
}

export interface WorkbenchSessionServiceApi
  extends WorkbenchSessionLifecycle {
  open(assetId: string, viewportId?: string): Promise<WorkbenchBootstrap>;
  command(
    sessionId: string,
    command: WorkbenchCommand,
  ): Promise<WorkbenchCommandResult>;
  close(sessionId: string): Promise<void>;
  getActiveSessionId(): string | undefined;
}

export interface WorkbenchSessionServiceDependencies {
  readonly createId: () => string;
  readonly transportBindingRegistry: WorkbenchTransportBindingRegistryApi;
}

export class WorkbenchSessionService
  implements WorkbenchSessionServiceApi
{
  private readonly sessionsByViewport = new Map<
    string,
    AssetWorkbenchSession
  >();
  /** Retain a small retired set so callers can distinguish stale from unknown. */
  private readonly retiredSessionIds: string[] = [];
  private readonly pendingOpenControllers = new Map<
    string,
    AbortController
  >();
  private readonly lifecycleVersions = new Map<string, number>();
  private readonly pendingCommands = new Map<
    string,
    Set<Promise<WorkbenchCommandResult>>
  >();
  private readonly createId: () => string;
  private readonly transportBindingRegistry:
    | WorkbenchTransportBindingRegistryApi
    | undefined;
  private readonly transportBindingDisposers = new Map<
    string,
    () => void
  >();

  constructor(
    private readonly assetService: AssetServiceApi,
    private readonly registry: WorkbenchRegistry,
    private readonly attachmentService: AttachmentServiceApi,
    private readonly stateDatabase: WorkbenchStateDatabaseApi,
    dependencies: Partial<WorkbenchSessionServiceDependencies> = {},
  ) {
    this.createId = dependencies.createId ?? randomUUID;
    this.transportBindingRegistry =
      dependencies.transportBindingRegistry;
  }

  async open(
    assetId: string,
    viewportId = 'primary-material',
  ): Promise<WorkbenchBootstrap> {
    const normalizedViewportId = this.normalizeViewportId(viewportId);
    this.pendingOpenControllers.get(normalizedViewportId)?.abort();
    const abortController = new AbortController();
    this.pendingOpenControllers.set(normalizedViewportId, abortController);
    const openVersion = this.nextLifecycleVersion(normalizedViewportId);
    await this.disposeViewportSession(normalizedViewportId);
    const snapshot = this.assetService.get(assetId);

    if (!snapshot) {
      throw new AppError('ASSET_NOT_FOUND');
    }

    const content = await this.assetService.resolveContent(assetId);

    if (!this.isCurrentOpen(normalizedViewportId, openVersion, abortController)) {
      await content.handle?.close();
      throw new AppError('OPERATION_SUPERSEDED');
    }

    const selection =
      content.contentStatus.availability === 'available'
        ? this.registry.select(snapshot.mediaType, content.handle)
        : this.registry.fallback('content-unavailable');
    const [attachments, state] = await Promise.all([
      this.attachmentService.listByAsset(snapshot.projectId, assetId),
      this.stateDatabase.get(assetId, selection.provider.manifest.id),
    ]);
    const session: AssetWorkbenchSession = {
      id: this.createId(),
      asset: snapshot,
      content,
      workbenchId: selection.provider.manifest.id,
      attachments,
      state,
      selectionReason: selection.reason,
      provider: selection.provider,
      abortController,
    };
    const context = toWorkbenchProviderContext(session);

    if (!this.isCurrentOpen(normalizedViewportId, openVersion, abortController)) {
      await this.disposeSession(session);
      throw new AppError('OPERATION_SUPERSEDED');
    }

    let result;

    try {
      result = await session.provider.open(context);
    } catch (error) {
      await this.disposeSession(session, context);
      throw error;
    }

    if (!this.isCurrentOpen(normalizedViewportId, openVersion, abortController)) {
      await this.disposeSession(session, context);
      throw new AppError('OPERATION_SUPERSEDED');
    }

    const transportBindings = result.transportBindings ?? [];

    try {
      if (
        transportBindings.length > 0 &&
        !this.transportBindingRegistry
      ) {
        throw new AppError('SERVICE_NOT_READY');
      }

      const disposeBindings =
        this.transportBindingRegistry?.registerSession(
          session.id,
          session.provider.manifest,
          transportBindings,
          session.provider.facilityAdapters ?? [],
        ) ?? (() => undefined);

      this.transportBindingDisposers.set(
        session.id,
        disposeBindings,
      );
    } catch (error) {
      await this.disposeSession(session, context);
      throw error;
    }

    this.sessionsByViewport.set(normalizedViewportId, session);
    if (this.pendingOpenControllers.get(normalizedViewportId) === abortController) {
      this.pendingOpenControllers.delete(normalizedViewportId);
    }

    return {
      sessionId: session.id,
      viewportId: normalizedViewportId,
      workbenchId: session.workbenchId,
      workbenchVersion: session.provider.manifest.version,
      protocolVersion: session.provider.manifest.protocolVersion,
      assetId: session.asset.id,
      mediaType: session.asset.mediaType,
      availability: session.content.contentStatus.availability,
      payload: result.payload,
    };
  }

  async command(
    sessionId: string,
    command: WorkbenchCommand,
  ): Promise<WorkbenchCommandResult> {
    const session = this.findSession(sessionId);

    if (!session) {
      throw new AppError(
        this.retiredSessionIds.includes(sessionId) ||
          this.sessionsByViewport.size > 0
          ? 'WORKBENCH_SESSION_EXPIRED'
          : 'WORKBENCH_SESSION_NOT_FOUND',
      );
    }

    const execution = session.provider.command(
      toWorkbenchProviderContext(session),
      command,
    );
    const pending =
      this.pendingCommands.get(session.id) ??
      new Set<Promise<WorkbenchCommandResult>>();

    pending.add(execution);
    this.pendingCommands.set(session.id, pending);

    try {
      return await execution;
    } finally {
      pending.delete(execution);
      if (pending.size === 0) {
        this.pendingCommands.delete(session.id);
      }
    }
  }

  async close(sessionId: string): Promise<void> {
    const session = this.findSession(sessionId);
    if (!session) {
      return;
    }
    const viewportId = this.viewportForSession(sessionId);
    if (!viewportId) return;
    this.nextLifecycleVersion(viewportId);
    this.sessionsByViewport.delete(viewportId);
    this.rememberRetiredSession(session.id);
    await this.disposeSession(session);
  }

  async closeActive(): Promise<void> {
    const pending = [...this.pendingOpenControllers.values()];
    this.pendingOpenControllers.clear();
    for (const controller of pending) controller.abort();
    const sessions = [...this.sessionsByViewport.entries()];
    this.sessionsByViewport.clear();
    for (const [viewportId] of sessions) this.nextLifecycleVersion(viewportId);
    for (const [, session] of sessions) this.rememberRetiredSession(session.id);
    await Promise.all(sessions.map(([, session]) => this.disposeSession(session)));
  }

  getActiveSessionId(): string | undefined {
    return this.sessionsByViewport.get('primary-material')?.id;
  }

  private async disposeViewportSession(viewportId: string): Promise<void> {
    const session = this.sessionsByViewport.get(viewportId);
    this.sessionsByViewport.delete(viewportId);

    if (session) {
      this.rememberRetiredSession(session.id);
      await this.disposeSession(session);
    }
  }

  private normalizeViewportId(viewportId: string): string {
    const normalized = viewportId.trim();
    if (!normalized) throw new AppError('INVALID_IPC_REQUEST');
    return normalized;
  }

  private nextLifecycleVersion(viewportId: string): number {
    const version = (this.lifecycleVersions.get(viewportId) ?? 0) + 1;
    this.lifecycleVersions.set(viewportId, version);
    return version;
  }

  private isCurrentOpen(
    viewportId: string,
    version: number,
    controller: AbortController,
  ): boolean {
    return (
      !controller.signal.aborted &&
      this.lifecycleVersions.get(viewportId) === version &&
      this.pendingOpenControllers.get(viewportId) === controller
    );
  }

  private findSession(sessionId: string): AssetWorkbenchSession | undefined {
    for (const session of this.sessionsByViewport.values()) {
      if (session.id === sessionId) return session;
    }
    return undefined;
  }

  private viewportForSession(sessionId: string): string | undefined {
    for (const [viewportId, session] of this.sessionsByViewport) {
      if (session.id === sessionId) return viewportId;
    }
    return undefined;
  }

  private rememberRetiredSession(sessionId: string): void {
    this.retiredSessionIds.push(sessionId);
    if (this.retiredSessionIds.length > 128) this.retiredSessionIds.shift();
  }

  private async disposeSession(
    session: AssetWorkbenchSession,
    context: WorkbenchProviderContext = toWorkbenchProviderContext(session),
  ): Promise<void> {
    session.abortController?.abort();
    const pendingCommands = this.pendingCommands.get(session.id);

    if (pendingCommands) {
      await Promise.allSettled([...pendingCommands]);
      this.pendingCommands.delete(session.id);
    }

    let bindingFailure: unknown;
    const disposeBindings =
      this.transportBindingDisposers.get(session.id);
    this.transportBindingDisposers.delete(session.id);

    try {
      disposeBindings?.();
    } catch (error) {
      bindingFailure = error;
    }

    const results = await Promise.allSettled([
      session.provider.close(context),
      session.content.handle?.close() ?? Promise.resolve(),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected',
    );

    if (bindingFailure !== undefined) {
      throw bindingFailure;
    }
    if (failure) {
      throw failure.reason;
    }
  }
}
