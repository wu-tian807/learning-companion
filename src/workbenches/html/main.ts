import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import { AppError } from '../../main/errors/app-error';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
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

function createResult(payload: JsonValue): WorkbenchCommandResult {
  return { payload };
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
    // 损坏数据按空索引处理，不阻塞对话栏。
  }
  return createHtmlConversationIndex();
}

export class HtmlWorkbenchProvider implements MainWorkbenchProvider {
  readonly manifest = htmlWorkbenchManifest;
  readonly facilityAdapters = createHtmlMainFacilityAdapters();
  private readonly sessions = new Set<string>();

  constructor(
    private readonly resourceService: ContentResourceServiceApi,
    private readonly stateDataDatabase: WorkbenchStateDataDatabaseApi,
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
