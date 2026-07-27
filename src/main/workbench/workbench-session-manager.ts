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
import type { WorkbenchStateRepository } from './workbench-state-repository';

export interface WorkbenchSessionLifecycle {
  closeActive(): Promise<void>;
}

export interface WorkbenchSessionManagerApi
  extends WorkbenchSessionLifecycle {
  open(assetId: string): Promise<WorkbenchBootstrap>;
  command(
    sessionId: string,
    command: WorkbenchCommand,
  ): Promise<WorkbenchCommandResult>;
  close(sessionId: string): Promise<void>;
  getActiveSessionId(): string | undefined;
}

export interface WorkbenchSessionManagerDependencies {
  readonly createId: () => string;
}

export class WorkbenchSessionManager
  implements WorkbenchSessionManagerApi
{
  private activeSession: AssetWorkbenchSession | undefined;
  private lifecycleVersion = 0;
  private readonly createId: () => string;

  constructor(
    private readonly assetService: AssetServiceApi,
    private readonly registry: WorkbenchRegistry,
    private readonly attachmentService: AttachmentServiceApi,
    private readonly stateRepository: WorkbenchStateRepository,
    dependencies: Partial<WorkbenchSessionManagerDependencies> = {},
  ) {
    this.createId = dependencies.createId ?? randomUUID;
  }

  async open(assetId: string): Promise<WorkbenchBootstrap> {
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
      this.attachmentService.listByAsset(assetId),
      this.stateRepository.get(assetId, selection.provider.manifest.id),
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

    this.activeSession = session;

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

    return session.provider.command(
      toWorkbenchProviderContext(session),
      command,
    );
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
    const results = await Promise.allSettled([
      session.provider.close(context),
      session.content.handle?.close() ?? Promise.resolve(),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected',
    );

    if (failure) {
      throw failure.reason;
    }
  }
}
