import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import { AppError } from '../../main/errors/app-error';
import type {
  MainWorkbenchProvider,
  MaterializedWorkbenchContent,
  WorkbenchMaterializationContext,
} from '../../main/workbench/workbench-session';
import type { SandboxFrameScriptExecutor } from '../../main/workbench/interaction/sandbox-frame-script-executor';
import type { WorkbenchEventBusApi } from '../../main/workbench/workbench-event-bus';
import type {
  JsonValue,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_FACILITY_VERSION,
  CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
} from '../../shared/workbench/facilities/core-facilities';
import {
  htmlEditCommands,
  htmlEditEvents,
  htmlFrameCommands,
  htmlWorkbenchManifest,
} from './shared';
import { createHtmlMainFacilityAdapters } from './main-facility-adapters';
import {
  htmlAnchorCommands,
  isHtmlAnchorClearCommandPayload,
  isHtmlAnchorCommandResult,
  isHtmlAnchorHighlightCommandPayload,
} from './anchor-commands';
import {
  createHtmlAnchorClearFrameScript,
  createHtmlAnchorHighlightFrameScript,
  createHtmlEditIndicatorClearFrameScript,
  createHtmlEditIndicatorFrameScript,
} from './html-anchor-frame-script';
import {
  htmlEditIndicatorCommands,
  isHtmlEditIndicatorClearCommandPayload,
  isHtmlEditIndicatorCommandResult,
  isHtmlEditIndicatorShowCommandPayload,
} from './html-edit-indicator-commands';
import {
  createHtmlSourceCopyInstallFrameScript,
  isHtmlSourceCopyInstallResult,
} from './html-source-copy-frame-script';
import type { HtmlAgentEditingService } from './editing/html-agent-editing-service';
import { HtmlPreviewContentHandle } from './editing/html-preview-content-handle';
import { createHtmlDomTarget } from './shared';

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

function anchorFrameTarget(target: {
  readonly anchorPayload: JsonValue;
}): { readonly frameUrl: string } | undefined {
  const payload = target.anchorPayload;

  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return undefined;
  }
  const record = payload as { readonly frameUrl?: JsonValue };

  return typeof record.frameUrl === 'string' && record.frameUrl !== 'about:blank'
    ? { frameUrl: record.frameUrl }
    : undefined;
}

export class HtmlWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = htmlWorkbenchManifest;
  readonly facilityAdapters = createHtmlMainFacilityAdapters();
  private readonly sessions = new Map<
    string,
    { readonly projectId: string; readonly assetId: string }
  >();

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly frameScriptExecutor: SandboxFrameScriptExecutor,
    private readonly editing?: HtmlAgentEditingService,
    private readonly events?: WorkbenchEventBusApi,
  ) {
    this.editing?.subscribe((event) => {
      for (const [sessionId, binding] of this.sessions) {
        if (
          binding.projectId !== event.projectId ||
          binding.assetId !== event.assetId
        ) {
          continue;
        }
        const type =
          event.type === 'started'
            ? htmlEditEvents.started
            : event.type === 'rejected'
              ? htmlEditEvents.rejected
              : event.type === 'ended'
                ? htmlEditEvents.ended
              : event.type === 'applied'
                ? htmlEditEvents.applied
                : htmlEditEvents.sessionChanged;
        this.events?.publish({
          sessionId,
          type,
          payload:
            event.type === 'session-changed'
              ? { reason: event.reason }
              : {
                  editId: event.editId,
                  executionId: event.executionId,
                  target: createHtmlDomTarget(event.target),
                  ...(event.type === 'applied'
                    ? { draftRevision: event.draftRevision }
                    : {}),
                  ...(event.type === 'rejected'
                    ? { reason: event.reason }
                    : {}),
                },
        });
      }
    });
  }

  async materializeContent(
    context: WorkbenchMaterializationContext,
  ): Promise<MaterializedWorkbenchContent> {
    if (this.editing) {
      try {
        const draft = await this.editing.getDraftSnapshot(
          context.asset.projectId,
          context.asset.id,
        );
        if (draft) {
          return { absolutePath: draft.absolutePath, mediaType: 'text/html' };
        }
      } catch (error) {
        throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
      }
    }
    if (context.content.location?.absolutePath) {
      return {
        absolutePath: context.content.location.absolutePath,
        mediaType: 'text/html',
      };
    }
    throw new AppError('ASSET_UNAVAILABLE');
  }

  async open(context: Parameters<MainWorkbenchProvider['open']>[0]) {
    const handle = context.content.handle;

    if (
      context.selectionReason !== 'matched' ||
      context.asset.mediaType !== 'text/html' ||
      !handle?.capabilities.has('read-stream') ||
      !handle.openByteStream
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    if (this.sessions.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    let editingStatus;
    let previewHandle = handle;
    if (this.editing) {
      previewHandle = new HtmlPreviewContentHandle(
        this.editing,
        context.asset.projectId,
        context.asset.id,
        handle,
      );
      try {
        const draft = await this.editing.getDraftSnapshot(
          context.asset.projectId,
          context.asset.id,
        );
        if (draft) {
          editingStatus = draft.status;
        }
      } catch (error) {
        throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
      }
    }
    const contentUrl = this.resourceService.register(
      context.sessionId,
      previewHandle,
      'text/html',
    );
    this.sessions.set(context.sessionId, {
      projectId: context.asset.projectId,
      assetId: context.asset.id,
    });

    return {
      payload: { contentUrl, ...(editingStatus ? { editing: editingStatus } : {}) },
      transportBindings: [
        {
          transportId:
            CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
          transportVersion: CORE_FACILITY_VERSION,
          facilities: [
            {
              id: CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
              version: CORE_FACILITY_VERSION,
            },
            {
              id: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
              version: CORE_FACILITY_VERSION,
            },
          ],
          payload: { rootUrl: contentUrl },
        },
      ],
    };
  }

  async command(
    context: Parameters<MainWorkbenchProvider['command']>[0],
    command: Parameters<MainWorkbenchProvider['command']>[1],
  ): Promise<WorkbenchCommandResult> {
    if (!this.sessions.has(context.sessionId)) {
      throw new AppError('WORKBENCH_SESSION_NOT_FOUND');
    }

    if (Object.values(htmlEditCommands).includes(command.type as never)) {
      if (!this.editing || command.payload !== undefined) {
        throw new AppError('FEATURE_NOT_SUPPORTED');
      }
      const projectId = context.asset.projectId;
      const assetId = context.asset.id;
      try {
        if (command.type === htmlEditCommands.status) {
          const draft = await this.editing.getDraftSnapshot(projectId, assetId);
          if (!draft) {
            throw new AppError('FEATURE_NOT_SUPPORTED');
          }
          return createResult(
            draft.status,
          );
        }
        if (command.type === htmlEditCommands.review) {
          return createResult(await this.editing.review(projectId, assetId));
        }
        if (command.type === htmlEditCommands.undo) {
          return createResult(await this.editing.undo(projectId, assetId));
        }
        if (command.type === htmlEditCommands.redo) {
          return createResult(await this.editing.redo(projectId, assetId));
        }
        if (command.type === htmlEditCommands.sync) {
          return createResult(await this.editing.requestSync(projectId, assetId));
        }
        return createResult(await this.editing.discard(projectId, assetId));
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
      }
    }

    if (command.type === htmlEditIndicatorCommands.show) {
      if (!isHtmlEditIndicatorShowCommandPayload(command.payload)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const result = await this.frameScriptExecutor.executeJavaScript(
        context.sessionId,
        createHtmlEditIndicatorFrameScript(command.payload),
        anchorFrameTarget(command.payload.target),
      );
      if (!isHtmlEditIndicatorCommandResult(result)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      return createResult(result);
    }

    if (command.type === htmlEditIndicatorCommands.clear) {
      if (!isHtmlEditIndicatorClearCommandPayload(command.payload)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const result = await this.frameScriptExecutor.executeJavaScript(
        context.sessionId,
        createHtmlEditIndicatorClearFrameScript(command.payload),
        anchorFrameTarget(command.payload.target),
      );
      if (!isHtmlEditIndicatorCommandResult(result)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      return createResult(result);
    }

    if (command.type === htmlFrameCommands.installSourceCopy) {
      if (command.payload !== undefined) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const result = await this.frameScriptExecutor.executeJavaScript(
        context.sessionId,
        createHtmlSourceCopyInstallFrameScript(),
      );
      if (!isHtmlSourceCopyInstallResult(result)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      return createResult(result);
    }

    if (command.type === htmlAnchorCommands.highlight) {
      if (!isHtmlAnchorHighlightCommandPayload(command.payload)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const result = await this.frameScriptExecutor.executeJavaScript(
        context.sessionId,
        createHtmlAnchorHighlightFrameScript(command.payload),
        anchorFrameTarget(command.payload.target),
      );
      if (!isHtmlAnchorCommandResult(result)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      return createResult(result);
    }

    if (command.type === htmlAnchorCommands.clear) {
      if (!isHtmlAnchorClearCommandPayload(command.payload)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      const result = await this.frameScriptExecutor.executeJavaScript(
        context.sessionId,
        createHtmlAnchorClearFrameScript(command.payload),
        anchorFrameTarget(command.payload.target),
      );
      if (!isHtmlAnchorCommandResult(result)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      return createResult(result);
    }

    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async close(
    context: Parameters<MainWorkbenchProvider['close']>[0],
  ): Promise<void> {
    if (this.sessions.delete(context.sessionId)) {
      this.resourceService.revokeSession(context.sessionId);
    }
  }
}
