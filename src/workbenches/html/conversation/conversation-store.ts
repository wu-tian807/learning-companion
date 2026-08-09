/**
 * Renderer-side store for HTML assistant conversations.
 *
 * Talks to the workbench provider through the generic `executeCommand`
 * channel (`html.conversations.list` / `html.conversations.append`).
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
  append(entry: HtmlConversationEntry): Promise<readonly HtmlConversationEntry[]>;
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

  return Object.freeze(value.entries.map((entry) => Object.freeze(entry)));
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
    async append(entry) {
      const result = await executeCommand({
        type: htmlConversationCommands.append,
        payload: { entry },
      });
      return parseEntries(result.payload);
    },
  };
}
