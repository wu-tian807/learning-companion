import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type { SandboxFrameScriptExecutor } from '../../main/workbench/interaction/sandbox-frame-script-executor';
import type { WorkbenchStateDataDatabaseApi } from '../../main/workbench/workbench-state-data-database';
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
  createHtmlConversationIndex,
  HTML_CONVERSATION_DATA_KEY,
  isHtmlConversationEntry,
  isHtmlConversationIndex,
  normalizeHtmlConversationIndex,
  removeHtmlConversationEntry,
  saveHtmlConversationEntry,
} from './conversation/conversation-protocol';
import {
  htmlConversationCommands,
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

  return typeof record.frameUrl === 'string'
    ? { frameUrl: record.frameUrl }
    : undefined;
}

function encodeConversationIndex(index: unknown): Uint8Array {
  if (!isHtmlConversationIndex(index)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return new TextEncoder().encode(JSON.stringify(index));
}

function decodeConversationIndex(
  data: Uint8Array,
): ReturnType<typeof createHtmlConversationIndex> {
  try {
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(data),
    );

    const normalized = normalizeHtmlConversationIndex(value);
    if (normalized) {
      return normalized;
    }
  } catch {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  throw new AppError('DATA_INTEGRITY_ERROR');
}

export class HtmlWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = htmlWorkbenchManifest;
  readonly facilityAdapters = createHtmlMainFacilityAdapters();
  private readonly sessions = new Set<string>();

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly stateDataDatabase: WorkbenchStateDataDatabaseApi,
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
    if (this.sessions.has(context.sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    const contentUrl = this.resourceService.register(
      context.sessionId,
      handle,
      'text/html',
    );
    this.sessions.add(context.sessionId);

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
    if (!this.sessions.has(context.sessionId)) {
      throw new AppError('WORKBENCH_SESSION_NOT_FOUND');
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

    const assetId = context.asset.id;

    if (command.type === htmlConversationCommands.list) {
      const record = await this.stateDataDatabase.get(
        assetId,
        htmlWorkbenchManifest.id,
        HTML_CONVERSATION_DATA_KEY,
      );
      const index = record
        ? decodeConversationIndex(record.data)
        : createHtmlConversationIndex();

      return createResult({ entries: index.entries });
    }

    if (command.type === htmlConversationCommands.save) {
      const entry = (command.payload as { readonly entry?: unknown } | undefined)
        ?.entry;

      if (!isHtmlConversationEntry(entry)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      const record = await this.stateDataDatabase.get(
        assetId,
        htmlWorkbenchManifest.id,
        HTML_CONVERSATION_DATA_KEY,
      );
      const index = record
        ? decodeConversationIndex(record.data)
        : createHtmlConversationIndex();
      const next = saveHtmlConversationEntry(index, entry);

      await this.stateDataDatabase.save({
        assetId,
        workbenchId: htmlWorkbenchManifest.id,
        dataKey: HTML_CONVERSATION_DATA_KEY,
        data: encodeConversationIndex(next),
        updatedTime: Math.max(
          entry.updatedTime,
          ...next.entries.map((candidate) => candidate.updatedTime),
        ),
      });

      return createResult({ entries: next.entries });
    }

    if (command.type === htmlConversationCommands.remove) {
      const entryId = (
        command.payload as { readonly entryId?: unknown } | undefined
      )?.entryId;

      if (typeof entryId !== 'string' || entryId.trim().length === 0) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      const record = await this.stateDataDatabase.get(
        assetId,
        htmlWorkbenchManifest.id,
        HTML_CONVERSATION_DATA_KEY,
      );
      const index = record
        ? decodeConversationIndex(record.data)
        : createHtmlConversationIndex();
      const next = removeHtmlConversationEntry(index, entryId);

      await this.stateDataDatabase.save({
        assetId,
        workbenchId: htmlWorkbenchManifest.id,
        dataKey: HTML_CONVERSATION_DATA_KEY,
        data: encodeConversationIndex(next),
        updatedTime: Date.now(),
      });

      return createResult({ entries: next.entries });
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
