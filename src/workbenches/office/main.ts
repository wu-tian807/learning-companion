import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import {
  LIBREOFFICE_PREVIEW_ARTIFACT_KEY,
  LIBREOFFICE_PREVIEW_PRODUCER_ID,
} from '../../main/artifacts/producers/libreoffice-preview-producer';
import { createFileContentRevision } from '../../main/content/content-revision';
import type {
  ContentHandle,
} from '../../main/content/content-handle';
import type {
  ContentResourceServiceApi,
} from '../../main/content/content-resource-service';
import { LocalFileContentHandle } from '../../main/content/resolvers/local-file/local-file-content-resolver';
import { AppError } from '../../main/errors/app-error';
import { LIBREOFFICE_LIBRARY_ID } from '../../main/external-libraries/definitions/libreoffice';
import type {
  ExternalLibraryServiceApi,
} from '../../main/external-libraries/external-library-service';
import type {
  ProjectLookup,
} from '../../main/projects/project-database';
import type {
  MainWorkbenchProvider,
} from '../../main/workbench/workbench-session';
import type {
  WorkbenchStateRecord,
  WorkbenchStateDatabaseApi,
} from '../../main/workbench/workbench-state-database';
import type {
  JsonValue,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import {
  clonePdfWorkbenchState,
  isPdfWorkbenchStateV1,
  type PdfWorkbenchViewState,
} from '../pdf/shared';
import {
  DEFAULT_OFFICE_WORKBENCH_STATE,
  isOfficeMediaType,
  isOfficeSaveViewStatePayload,
  OFFICE_STATE_SCHEMA_VERSION,
  OFFICE_WORKBENCH_ID,
  officeCommands,
  officeWorkbenchManifest,
  type OfficePreparePreviewResult,
  type OfficeWorkbenchPayload,
} from './shared';

interface OfficeSession {
  readonly request: AssetArtifactRequest;
  viewState: PdfWorkbenchViewState;
  artifactHandle?: ContentHandle;
  readyPayload?: JsonValue & OfficePreparePreviewResult;
}

export interface OfficeWorkbenchProviderDependencies {
  readonly now: () => number;
}

function toJsonState(state: PdfWorkbenchViewState): JsonValue {
  return clonePdfWorkbenchState(state);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'AbortError'
  );
}

export class OfficeWorkbenchProvider
  implements MainWorkbenchProvider
{
  readonly manifest = officeWorkbenchManifest;
  private readonly sessions = new Map<string, OfficeSession>();
  private readonly now: () => number;

  constructor(
    private readonly artifacts: AssetArtifactServiceApi,
    private readonly resources: ContentResourceServiceApi,
    private readonly externalLibraries: ExternalLibraryServiceApi,
    private readonly projects: ProjectLookup,
    private readonly stateDatabase: WorkbenchStateDatabaseApi,
    dependencies: Partial<OfficeWorkbenchProviderDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async open(
    context: Parameters<MainWorkbenchProvider['open']>[0],
  ) {
    if (
      context.selectionReason !== 'matched' ||
      !isOfficeMediaType(context.asset.mediaType) ||
      context.content.location?.kind !== 'local-file' ||
      !context.content.handle?.capabilities.has('read-stream')
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    if (this.sessions.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    const project = this.projects.get(context.asset.projectId);

    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    let sourceRevision: string;

    try {
      sourceRevision = await createFileContentRevision(
        context.content.location.absolutePath,
        context.signal,
      );
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      throw new AppError('ASSET_UNAVAILABLE', { cause: error });
    }

    const request: AssetArtifactRequest = {
      assetId: context.asset.id,
      producerId: LIBREOFFICE_PREVIEW_PRODUCER_ID,
      artifactKey: LIBREOFFICE_PREVIEW_ARTIFACT_KEY,
      workspacePath: project.workspacePath,
      source: {
        assetId: context.asset.id,
        mediaType: context.asset.mediaType,
        absolutePath: context.content.location.absolutePath,
        revision: sourceRevision,
      },
    };
    const session: OfficeSession = {
      request,
      viewState: this.readViewState(context.state),
    };
    this.sessions.set(context.sessionId, session);

    try {
      const cached = await this.artifacts.getCached(request);

      if (cached) {
        return {
          payload: await this.attachArtifact(
            context.sessionId,
            session,
            cached,
          ),
        };
      }

      try {
        await this.externalLibraries.requireExecutable(
          LIBREOFFICE_LIBRARY_ID,
        );
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === 'EXTERNAL_LIBRARY_NOT_INSTALLED'
        ) {
          return {
            payload: this.createPendingPayload(
              'runtime-required',
              session.viewState,
            ),
          };
        }

        throw error;
      }

      return {
        payload: this.createPendingPayload(
          'conversion-required',
          session.viewState,
        ),
      };
    } catch (error) {
      this.sessions.delete(context.sessionId);
      throw error;
    }
  }

  async command(
    context: Parameters<MainWorkbenchProvider['command']>[0],
    command: Parameters<MainWorkbenchProvider['command']>[1],
  ): Promise<WorkbenchCommandResult> {
    const session = this.sessions.get(context.sessionId);

    if (!session) {
      throw new AppError('WORKBENCH_SESSION_NOT_FOUND');
    }

    if (command.type === officeCommands.preparePreview) {
      if (session.readyPayload) {
        return { payload: session.readyPayload };
      }

      const artifact = await this.artifacts.getOrCreate(
        session.request,
        context.signal,
      );
      return {
        payload: await this.attachArtifact(
          context.sessionId,
          session,
          artifact,
        ),
      };
    }

    if (command.type === officeCommands.saveViewState) {
      if (!isOfficeSaveViewStatePayload(command.payload)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }

      const savedTime = this.now();
      session.viewState = clonePdfWorkbenchState(
        command.payload.viewState,
      );
      await this.stateDatabase.save({
        assetId: context.asset.id,
        workbenchId: OFFICE_WORKBENCH_ID,
        schemaVersion: OFFICE_STATE_SCHEMA_VERSION,
        payload: toJsonState(session.viewState),
        updatedTime: savedTime,
      });

      return {
        payload: { saved: true, savedTime },
      };
    }

    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async close(
    context: Parameters<MainWorkbenchProvider['close']>[0],
  ): Promise<void> {
    const session = this.sessions.get(context.sessionId);

    if (!session) {
      return;
    }

    this.sessions.delete(context.sessionId);
    this.resources.revokeSession(context.sessionId);
    await session.artifactHandle?.close();
  }

  private async attachArtifact(
    sessionId: string,
    session: OfficeSession,
    artifact: ResolvedAssetArtifact,
  ): Promise<JsonValue & OfficePreparePreviewResult> {
    if (artifact.artifact.mediaType !== 'application/pdf') {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    this.resources.revokeSession(sessionId);
    await session.artifactHandle?.close();
    const handle = new LocalFileContentHandle(
      artifact.absolutePath,
    );
    const contentUrl = this.resources.register(
      sessionId,
      handle,
      'application/pdf',
    );
    const payload: JsonValue & OfficePreparePreviewResult = {
      status: 'ready',
      contentUrl,
      viewState: clonePdfWorkbenchState(session.viewState),
    };
    session.artifactHandle = handle;
    session.readyPayload = payload;
    return payload;
  }

  private createPendingPayload(
    status: 'runtime-required' | 'conversion-required',
    viewState: PdfWorkbenchViewState,
  ): JsonValue & OfficeWorkbenchPayload {
    return {
      status,
      viewState: clonePdfWorkbenchState(viewState),
    };
  }

  private readViewState(
    record: WorkbenchStateRecord | undefined,
  ): PdfWorkbenchViewState {
    if (
      !record ||
      record.workbenchId !== OFFICE_WORKBENCH_ID ||
      record.schemaVersion !== OFFICE_STATE_SCHEMA_VERSION ||
      !isPdfWorkbenchStateV1(record.payload)
    ) {
      return clonePdfWorkbenchState(
        DEFAULT_OFFICE_WORKBENCH_STATE,
      );
    }

    return clonePdfWorkbenchState(record.payload);
  }
}
