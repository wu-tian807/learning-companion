import type Database from 'better-sqlite3';

import {
  cloneConversationRecord,
  PROJECT_CONVERSATION_MAX_CONVERSATIONS,
  type ConversationMessageRecord,
  type ConversationRecord,
} from '../../../shared/project-conversations';
import {
  HTML_CONVERSATION_DATA_KEY,
  normalizeHtmlConversationIndex,
  type HtmlConversationEntry,
} from '../../../workbenches/html/conversation/conversation-protocol';
import { HTML_WORKBENCH_ID } from '../../../workbenches/html/shared';

interface LegacyHtmlConversationRow {
  readonly assetId: string;
  readonly projectId: string;
  readonly data: Buffer;
}

interface ExistingConversationRow {
  readonly projectId: string;
  readonly updatedTime: number;
}

function conversationTitle(entry: HtmlConversationEntry): string {
  const firstQuestion = entry.messages.find(
    (message) => message.role === 'user',
  )?.text;
  const normalized = firstQuestion
    ?.replace(/^\s*(?:Question|问题)\s*[:：]\s*/iu, '')
    .split(/\r?\n/u, 1)[0]
    ?.trim();
  return (normalized || '历史问答').slice(0, 128);
}

function conversationMessageId(conversationId: string, index: number): string {
  const suffix = `:legacy-html:${index + 1}`;
  return `${conversationId.slice(0, 160 - suffix.length)}${suffix}`;
}

function convertLegacyHtmlConversation(
  entry: HtmlConversationEntry,
): ConversationRecord {
  let previousUserMessageId: string | undefined;
  const messages: ConversationMessageRecord[] = entry.messages.map(
    (message, index) => {
      const id = conversationMessageId(entry.id, index);
      const converted: ConversationMessageRecord = {
        id,
        role: message.role,
        text: message.text,
        createdTime: entry.createdTime,
        ...(message.role === 'assistant' && previousUserMessageId
          ? { replyToMessageId: previousUserMessageId }
          : {}),
        ...(message.generationTaskId
          ? { generationTaskId: message.generationTaskId }
          : {}),
        ...(message.anchor === undefined
          ? {}
          : { context: message.anchor }),
        ...(message.stopped ? { stopped: true } : {}),
      };
      if (message.role === 'user') previousUserMessageId = id;
      return converted;
    },
  );
  return cloneConversationRecord({
    id: entry.id,
    title: conversationTitle(entry),
    messages,
    createdTime: entry.createdTime,
    updatedTime: entry.updatedTime,
  });
}

function migrateLegacyHtmlConversations(sqlite: Database.Database): void {
  const rows = sqlite
    .prepare(
      `SELECT
         data.asset_id AS assetId,
         assets.project_id AS projectId,
         data.data AS data
       FROM workbench_state_data data
       INNER JOIN assets ON assets.id = data.asset_id
       WHERE data.workbench_id = ? AND data.data_key = ?`,
    )
    .all(
      HTML_WORKBENCH_ID,
      HTML_CONVERSATION_DATA_KEY,
    ) as LegacyHtmlConversationRow[];
  const findExisting = sqlite.prepare<
    [string],
    ExistingConversationRow
  >(
    `SELECT project_id AS projectId, updated_time AS updatedTime
     FROM project_conversations
     WHERE id = ?`,
  );
  const insert = sqlite.prepare(
    `INSERT INTO project_conversations (
       id, project_id, title, messages_json, created_time, updated_time
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const update = sqlite.prepare(
    `UPDATE project_conversations
     SET title = ?, messages_json = ?, updated_time = ?
     WHERE id = ? AND project_id = ?`,
  );
  const removeLegacy = sqlite.prepare(
    `DELETE FROM workbench_state_data
     WHERE asset_id = ? AND workbench_id = ? AND data_key = ?`,
  );

  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(row.data),
      );
    } catch {
      continue;
    }
    const legacy = normalizeHtmlConversationIndex(parsed);
    if (!legacy) continue;

    for (const entry of legacy.entries) {
      const conversation = convertLegacyHtmlConversation(entry);
      const existing = findExisting.get(conversation.id);
      if (existing && existing.projectId !== row.projectId) {
        throw new Error(
          `HTML Conversation ${conversation.id} 跨 Project 冲突`,
        );
      }
      if (!existing) {
        insert.run(
          conversation.id,
          row.projectId,
          conversation.title,
          JSON.stringify(conversation.messages),
          conversation.createdTime,
          conversation.updatedTime,
        );
      } else if (conversation.updatedTime >= existing.updatedTime) {
        update.run(
          conversation.title,
          JSON.stringify(conversation.messages),
          conversation.updatedTime,
          conversation.id,
          row.projectId,
        );
      }
    }
    removeLegacy.run(
      row.assetId,
      HTML_WORKBENCH_ID,
      HTML_CONVERSATION_DATA_KEY,
    );
  }
  sqlite
    .prepare(
      `DELETE FROM project_conversations
       WHERE id IN (
         SELECT id
         FROM (
           SELECT
             id,
             ROW_NUMBER() OVER (
               PARTITION BY project_id
               ORDER BY updated_time DESC, id ASC
             ) AS position
           FROM project_conversations
         ) ranked
         WHERE position > ?
       )`,
    )
    .run(PROJECT_CONVERSATION_MAX_CONVERSATIONS);
}

export const createProjectConversationsMigration = {
  version: 24,
  sql: `
    CREATE TABLE IF NOT EXISTS project_conversations (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      messages_json TEXT NOT NULL CHECK (json_valid(messages_json)),
      created_time INTEGER NOT NULL,
      updated_time INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS project_conversations_project_updated_index
      ON project_conversations(project_id, updated_time, id);
  `,
  apply: migrateLegacyHtmlConversations,
} as const;
