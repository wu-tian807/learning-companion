import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type {
  WorkbenchStateRecord,
  WorkbenchStateRepository,
} from '../../main/workbench/workbench-state-repository';
import type {
  JsonValue,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import {
  resolveMindMapAssociations,
  type MindMapAssociationLookup,
} from './association-mapper';
import type { MindMapDocumentV1 } from './document';
import {
  DefaultMindMapContentAdapter,
  type MindMapContentAdapter,
} from './mindmap-content-adapter';
import {
  cloneMindMapWorkbenchViewState,
  isMindMapSaveViewStatePayload,
  isMindMapWorkbenchPayload,
  isMindMapWorkbenchStateV1,
  MIND_MAP_STATE_SCHEMA_VERSION,
  MIND_MAP_WORKBENCH_ID,
  mindMapCommands,
  mindMapWorkbenchManifest,
  type MindMapWorkbenchViewStateV1,
} from './shared';

export interface MindMapWorkbenchProviderDependencies {
  readonly contentAdapter: MindMapContentAdapter;
  readonly now: () => number;
}

interface MindMapSessionState {
  readonly collapsibleNodeIds: ReadonlySet<string>;
}

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

function toJsonState(
  viewState: MindMapWorkbenchViewStateV1,
): JsonValue {
  return {
    viewState: cloneMindMapWorkbenchViewState(viewState),
  };
}

function collapsibleNodeIds(
  document: MindMapDocumentV1,
): ReadonlySet<string> {
  return new Set(
    Object.values(document.nodes)
      .filter((node) => node.childIds.length > 0)
      .map((node) => node.id),
  );
}

export class MindMapWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = mindMapWorkbenchManifest;
  private readonly sessions = new Map<string, MindMapSessionState>();
  private readonly contentAdapter: MindMapContentAdapter;
  private readonly now: () => number;

  constructor(
    private readonly stateRepository: WorkbenchStateRepository,
    private readonly associationLookup: MindMapAssociationLookup,
    dependencies: Partial<MindMapWorkbenchProviderDependencies> = {},
  ) {
    this.contentAdapter =
      dependencies.contentAdapter ?? new DefaultMindMapContentAdapter();
    this.now = dependencies.now ?? Date.now;
  }

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    const handle = context.content.handle;

    if (
      context.selectionReason !== 'matched' ||
      !handle?.capabilities.has('read-bytes') ||
      !handle.readBytes
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    if (this.sessions.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    const resolvedContent = await this.contentAdapter.read(handle);
    context.signal?.throwIfAborted();
    const associations = resolveMindMapAssociations(
      context.asset.id,
      resolvedContent.document,
      this.associationLookup,
    );
    const collapsibleIds = collapsibleNodeIds(
      resolvedContent.document,
    );
    const viewState = this.readViewState(
      context.state,
      collapsibleIds,
    );
    const payload = {
      document: resolvedContent.document,
      revision: resolvedContent.revision,
      associations,
      viewState,
    };

    if (!isMindMapWorkbenchPayload(payload)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    this.sessions.set(context.sessionId, {
      collapsibleNodeIds: collapsibleIds,
    });

    return { payload };
  }

  async command(
    context: Parameters<MainWorkbenchProvider['command']>[0],
    command: Parameters<MainWorkbenchProvider['command']>[1],
  ): Promise<WorkbenchCommandResult> {
    const session = this.sessions.get(context.sessionId);

    if (!session) {
      throw new AppError('WORKBENCH_SESSION_NOT_FOUND');
    }

    if (
      command.type !== mindMapCommands.saveViewState ||
      !isMindMapSaveViewStatePayload(command.payload)
    ) {
      throw new AppError(
        command.type === mindMapCommands.saveViewState
          ? 'INVALID_IPC_REQUEST'
          : 'FEATURE_NOT_SUPPORTED',
      );
    }

    if (
      command.payload.viewState.collapsedNodeIds.some(
        (nodeId) => !session.collapsibleNodeIds.has(nodeId),
      )
    ) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    const savedTime = this.now();
    await this.stateRepository.save({
      assetId: context.asset.id,
      workbenchId: MIND_MAP_WORKBENCH_ID,
      schemaVersion: MIND_MAP_STATE_SCHEMA_VERSION,
      payload: toJsonState(command.payload.viewState),
      updatedTime: savedTime,
    });

    return createResult({ saved: true, savedTime });
  }

  async close(
    context: Parameters<MainWorkbenchProvider['close']>[0],
  ): Promise<void> {
    this.sessions.delete(context.sessionId);
  }

  private readViewState(
    record: WorkbenchStateRecord | undefined,
    collapsibleIds: ReadonlySet<string>,
  ): JsonValue & MindMapWorkbenchViewStateV1 {
    if (
      !record ||
      record.workbenchId !== MIND_MAP_WORKBENCH_ID ||
      record.schemaVersion !== MIND_MAP_STATE_SCHEMA_VERSION ||
      !isMindMapWorkbenchStateV1(record.payload)
    ) {
      return cloneMindMapWorkbenchViewState({
        collapsedNodeIds: [...collapsibleIds],
      });
    }

    return cloneMindMapWorkbenchViewState({
      collapsedNodeIds:
        record.payload.viewState.collapsedNodeIds.filter((nodeId) =>
          collapsibleIds.has(nodeId),
        ),
      ...(record.payload.viewState.viewport
        ? { viewport: record.payload.viewState.viewport }
        : {}),
    });
  }
}
