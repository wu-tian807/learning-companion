import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type { SandboxFrameScriptExecutor } from '../../main/workbench/interaction/sandbox-frame-script-executor';
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
} from './html-anchor-frame-script';
import {
  createHtmlSourceCopyInstallFrameScript,
  isHtmlSourceCopyInstallResult,
} from './html-source-copy-frame-script';

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
}

function anchorFrameTarget(target: {
  readonly anchorPayload: JsonValue;
}, rootUrl: string): { readonly frameUrl: string } | undefined {
  const payload = target.anchorPayload;

  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return undefined;
  }
  const record = payload as { readonly frameUrl?: JsonValue };

  if (typeof record.frameUrl !== 'string' || record.frameUrl === rootUrl) {
    return undefined;
  }
  try {
    const persisted = new URL(record.frameUrl);
    const current = new URL(rootUrl);
    const isManagedRoot = (url: URL) =>
      url.protocol === 'learning-content:' &&
      url.hostname === 'resource' &&
      /^\/[^/]+\/?$/u.test(url.pathname);
    if (isManagedRoot(persisted) && isManagedRoot(current)) return undefined;
  } catch {
    // Non-URL frame locators are passed through and rejected by the bridge.
  }
  return { frameUrl: record.frameUrl };
}

export class HtmlWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = htmlWorkbenchManifest;
  readonly facilityAdapters = createHtmlMainFacilityAdapters();
  private readonly sessionRootUrls = new Map<string, string>();

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly frameScriptExecutor: SandboxFrameScriptExecutor,
  ) {}

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
    if (this.sessionRootUrls.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    const contentUrl = this.resourceService.register(
      context.sessionId,
      handle,
      'text/html',
    );
    this.sessionRootUrls.set(context.sessionId, contentUrl);

    return {
      payload: { contentUrl },
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
    const rootUrl = this.sessionRootUrls.get(context.sessionId);
    if (!rootUrl) {
      throw new AppError('WORKBENCH_SESSION_NOT_FOUND');
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
        anchorFrameTarget(command.payload.target, rootUrl),
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
        anchorFrameTarget(command.payload.target, rootUrl),
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
    if (this.sessionRootUrls.delete(context.sessionId)) {
      this.resourceService.revokeSession(context.sessionId);
    }
  }
}
