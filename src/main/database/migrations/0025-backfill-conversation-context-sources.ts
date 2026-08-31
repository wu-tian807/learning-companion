import type Database from 'better-sqlite3';

import {
  WORKBENCH_CONVERSATION_INSTRUCTION_FORMAT,
  WORKBENCH_CONVERSATION_INSTRUCTION_VERSION,
  WORKBENCH_CONVERSATION_SOURCE_SLOT,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';

interface ConversationRow {
  readonly id: string;
  readonly project_id: string;
  readonly messages_json: string;
}

interface TaskRow {
  readonly project_id: string;
  readonly definition_id: string;
  readonly definition_version: number;
  readonly instruction_json: string;
  readonly asset_references_json: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseRecord(value: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function requiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function contextSource(
  conversation: ConversationRow,
  message: Record<string, unknown>,
  task: TaskRow | undefined,
): Record<string, unknown> | undefined {
  if (!task || task.project_id !== conversation.project_id ||
    task.definition_id !== WORKBENCH_CONVERSATION_TASK_DEFINITION_ID ||
    task.definition_version !== WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION) {
    return undefined;
  }
  const instruction = parseRecord(task.instruction_json);
  if (!instruction ||
    instruction.format !== WORKBENCH_CONVERSATION_INSTRUCTION_FORMAT ||
    instruction.version !== WORKBENCH_CONVERSATION_INSTRUCTION_VERSION ||
    instruction.conversationId !== conversation.id ||
    instruction.question !== message.text ||
    JSON.stringify(instruction.context) !== JSON.stringify(message.context) ||
    !requiredText(instruction.contextProviderId) ||
    !requiredText(instruction.assetId)) {
    return undefined;
  }
  const references = parseRecord(task.asset_references_json);
  if (!references) return undefined;
  const source = references[WORKBENCH_CONVERSATION_SOURCE_SLOT];
  if (source !== undefined && !Array.isArray(source)) return undefined;
  const reference = Array.isArray(source) && source.some(
    (candidate) => record(candidate)?.assetId === instruction.assetId,
  );
  return {
    contextProviderId: instruction.contextProviderId,
    assetId: instruction.assetId,
    sourceAssetMode: reference ? 'reference' : 'identity',
    ...(instruction.commitAnswer === true ? { commitAnswer: true } : {}),
  };
}

export const backfillConversationContextSourcesMigration = {
  version: 25,
  sql: '',
  apply(sqlite: Database.Database): void {
    const rows = sqlite.prepare<[], ConversationRow>(`
      SELECT id, project_id, messages_json FROM project_conversations
    `).all();
    const findTask = sqlite.prepare<[string], TaskRow>(`
      SELECT project_id, definition_id, definition_version,
             instruction_json, asset_references_json
      FROM generation_tasks WHERE id = ?
    `);
    const update = sqlite.prepare<[string, string]>(`
      UPDATE project_conversations SET messages_json = ? WHERE id = ?
    `);

    for (const conversation of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(conversation.messages_json);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      const records = parsed.map(record);
      if (records.some((value) => value === undefined)) continue;
      let changed = false;
      const messages = records.map((value) => ({ ...value! }));
      for (const message of messages) {
        if (message.role !== 'user' || message.context === undefined ||
          message.contextSource !== undefined || typeof message.id !== 'string') {
          continue;
        }
        const assistant = [...messages].reverse().find((candidate) =>
          candidate.role === 'assistant' &&
          candidate.replyToMessageId === message.id &&
          typeof candidate.generationTaskId === 'string');
        const source = contextSource(
          conversation,
          message,
          assistant ? findTask.get(String(assistant.generationTaskId)) : undefined,
        );
        if (!source) continue;
        message.contextSource = source;
        changed = true;
      }
      if (changed) update.run(JSON.stringify(messages), conversation.id);
    }
  },
} as const;
