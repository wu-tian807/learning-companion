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
  open(assetId: string): Promise<WorkbenchBootstrap>;
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
  private activeSession: AssetWorkbenchSession | undefined;
  private pendingOpenController: AbortController | undefined;
  private readonly pendingCommands = new Map<
    string,
    Set<Promise<WorkbenchCommandResult>>
  >();
  private lifecycleVersion = 0;
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

  async open(assetId: string): Promise<WorkbenchBootstrap> {
    this.pendingOpenController?.abort();
    const abortController = new AbortController();
    this.pendingOpenController = abortController;
    const openVersion = this.lifecycleVersion + 1;
    this.lifecycleVersion = openVersion;
    await this.disposeActiveSession();
    const snapshot = this.assetService.get(assetId);

    if (!snapshot) {
      throw new AppError('ASSET_NOT_FOUND');
    }

    const content = await this.assetService.resolveContent(assetId);

    if (this.lifecycleVersion !== openVersion) {
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

    if (this.lifecycleVersion !== openVersion) {
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

    if (this.lifecycleVersion !== openVersion) {
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
        ) ?? (() => undefined);

      this.transportBindingDisposers.set(
        session.id,
        disposeBindings,
      );
    } catch (error) {
      await this.disposeSession(session, context);
      throw error;
    }

    this.activeSession = session;
    if (this.pendingOpenController === abortController) {
      this.pendingOpenController = undefined;
    }

    return {
      sessionId: session.id,
      workbenchId: session.workbenchId,
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
    const session = this.activeSession;

    if (!session) {
      throw new AppError('WORKBENCH_SESSION_NOT_FOUND');
    }

    if (session.id !== sessionId) {
      throw new AppError('WORKBENCH_SESSION_EXPIRED');
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
    const session = this.activeSession;

    if (!session || session.id !== sessionId) {
      return;
    }

    this.lifecycleVersion += 1;
    this.activeSession = undefined;
    await this.disposeSession(session);
  }

  async closeActive(): Promise<void> {
    this.pendingOpenController?.abort();
    this.pendingOpenController = undefined;

    if (!this.activeSession) {
      this.lifecycleVersion += 1;
      return;
    }

    this.lifecycleVersion += 1;
    await this.disposeActiveSession();
  }

  getActiveSessionId(): string | undefined {
    return this.activeSession?.id;
  }

  private async disposeActiveSession(): Promise<void> {
    const session = this.activeSession;
    this.activeSession = undefined;

    if (session) {
      await this.disposeSession(session);
    }
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
