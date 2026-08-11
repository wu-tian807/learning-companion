/**
 * Renderer-side store for HTML assistant conversations.
 *
 * Talks to the workbench provider through the generic `executeCommand`
 * channel (`html.conversations.list` / `html.conversations.save`).
 * Every payload crossing the IPC boundary is validated on receipt.
 */
import type { WorkbenchCommand } from '../../../shared/workbench/protocol';
import { htmlConversationCommands } from '../shared';
import {
  isHtmlConversationEntry,
  type HtmlConversationEntry,
} from './conversation-protocol';

export interface HtmlConversationStore {
  list(): Promise<readonly HtmlConversationEntry[]>;
  /** Insert a conversation or update the entry with the same stable id. */
  save(entry: HtmlConversationEntry): Promise<readonly HtmlConversationEntry[]>;
  /** 删除一条历史对话。 */
  remove(entryId: string): Promise<readonly HtmlConversationEntry[]>;
}

export interface HtmlConversationStoreOptions {
  readonly executeCommand: (
    command: WorkbenchCommand,
  ) => Promise<{ readonly payload: unknown }>;
}

function parseEntries(value: unknown): readonly HtmlConversationEntry[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('entries' in value) ||
    !Array.isArray(value.entries) ||
    !value.entries.every(isHtmlConversationEntry)
  ) {
    throw new Error('HtmlConversation list 响应数据无效');
  }

  const entries = value.entries.map((entry) => {
    const record = entry as HtmlConversationEntry;
    return Object.freeze({
      id: record.id,
      messages: Object.freeze(
        record.messages.map((message) =>
          Object.freeze({
            role: message.role,
            text: message.text,
            ...(message.anchor === undefined
              ? {}
              : { anchor: message.anchor }),
            ...(message.stopped === undefined
              ? {}
              : { stopped: message.stopped }),
          }),
        ),
      ),
      createdTime: record.createdTime,
      updatedTime: record.updatedTime,
    }) as HtmlConversationEntry;
  });

  return Object.freeze(entries);
}

export function createHtmlConversationStore({
  executeCommand,
}: HtmlConversationStoreOptions): HtmlConversationStore {
  return {
    async list() {
      const result = await executeCommand({
        type: htmlConversationCommands.list,
      });
      return parseEntries(result.payload);
    },
    async save(entry) {
      const result = await executeCommand({
        type: htmlConversationCommands.save,
        payload: { entry },
      });
      return parseEntries(result.payload);
    },
    async remove(entryId) {
      const result = await executeCommand({
        type: htmlConversationCommands.remove,
        payload: { entryId },
      });
      return parseEntries(result.payload);
    },
  };
}
