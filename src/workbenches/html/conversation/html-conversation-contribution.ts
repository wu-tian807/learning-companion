import type {
  ConversationHistoryStore,
  ConversationRecord,
  WorkbenchConversationContribution,
} from '../../../renderer/conversation/conversation-contracts';
import {
  HTML_ASSISTANT_INSTRUCTION_FORMAT,
  HTML_ASSISTANT_INSTRUCTION_VERSION,
  HTML_ASSISTANT_TASK_DEFINITION_ID,
  HTML_ASSISTANT_TASK_DEFINITION_VERSION,
} from '../../../shared/generation-definitions';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { isHtmlAnchorTarget, type HtmlAnchorTarget } from '../anchor-commands';
import { isHtmlAssistantTaskResult } from '../generation/html-assistant-result';
import { htmlWorkbenchManifest } from '../shared';
import { summarizeHtmlAnchor } from './anchor-summary';
import type { HtmlConversationStore } from './conversation-store';

function titleFromRecord(record: ConversationRecord): string {
  const firstQuestion = record.messages.find((message) => message.role === 'user');
  return (firstQuestion?.text.trim() || record.title || '历史问答').slice(0, 32);
}

export function shouldClearHtmlConversationHighlight(
  released: JsonValue | undefined,
  active: HtmlAnchorTarget | undefined,
): boolean {
  return (
    released === undefined ||
    !isHtmlAnchorTarget(released) ||
    active === undefined ||
    JSON.stringify(released) === JSON.stringify(active)
  );
}

export function adaptHtmlConversationHistoryStore(
  store: HtmlConversationStore,
): ConversationHistoryStore {
  const toGeneric = (entries: Awaited<ReturnType<HtmlConversationStore['list']>>) =>
    Object.freeze(entries.map((entry): ConversationRecord => Object.freeze({
      id: entry.id,
      title: titleFromRecord({
        id: entry.id,
        title: '历史问答',
        messages: entry.messages.map((message, index) => ({
          id: `restored:${entry.id}:${index}`,
          role: message.role,
          text: message.text,
          createdTime: entry.createdTime + index,
        })),
        createdTime: entry.createdTime,
        updatedTime: entry.updatedTime,
      }),
      messages: Object.freeze(entry.messages.map((message, index) => Object.freeze({
        id: `restored:${entry.id}:${index}`,
        role: message.role,
        text: message.text,
        createdTime: entry.createdTime + index,
        ...(message.generationTaskId === undefined
          ? {}
          : { generationTaskId: message.generationTaskId }),
        ...(message.anchor === undefined ? {} : { context: message.anchor }),
        ...(message.stopped === undefined ? {} : { stopped: message.stopped }),
      }))),
      createdTime: entry.createdTime,
      updatedTime: entry.updatedTime,
    })));

  return {
    async list() {
      return toGeneric(await store.list());
    },
    async save(record) {
      const entries = await store.save({
        id: record.id,
        messages: record.messages.map((message) => ({
          role: message.role,
          text: message.text,
          ...(message.generationTaskId === undefined
            ? {}
            : { generationTaskId: message.generationTaskId }),
          ...(message.context === undefined ? {} : { anchor: message.context }),
          ...(message.stopped === undefined ? {} : { stopped: message.stopped }),
        })),
        createdTime: record.createdTime,
        updatedTime: record.updatedTime,
      });
      return toGeneric(entries);
    },
    async remove(conversationId) {
      return toGeneric(await store.remove(conversationId));
    },
  };
}

export function createHtmlConversationContribution(input: {
  readonly assetId: string;
  readonly historyStore: ConversationHistoryStore;
  readonly revealContext: (context: JsonValue) => Promise<void> | void;
  readonly onContextReleased?: (context: JsonValue | undefined) => void;
}): WorkbenchConversationContribution {
  const contribution: WorkbenchConversationContribution = {
    id: 'html.assistant',
    workbenchId: htmlWorkbenchManifest.id,
    title: '网页问答',
    emptyLabel: '选中网页文字或元素后开始提问，也可以直接针对整份 HTML 资料提问。',
    historyStore: input.historyStore,
    createTaskRequest(taskInput) {
      return {
        projectId: taskInput.projectId,
        definitionId: HTML_ASSISTANT_TASK_DEFINITION_ID,
        definitionVersion: HTML_ASSISTANT_TASK_DEFINITION_VERSION,
        instruction: {
          format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
          version: HTML_ASSISTANT_INSTRUCTION_VERSION,
          conversationId: taskInput.conversationId,
          question: taskInput.question,
          ...(taskInput.context === undefined ? {} : { anchor: taskInput.context }),
        },
        assetReferences: {
          sources: [{ assetId: taskInput.assetId }],
        },
      };
    },
    readTaskResult(task) {
      if (!isHtmlAssistantTaskResult(task.result)) return undefined;
      const modelInfo = task.assignedProviderId && task.assignedModelId
        ? `${task.assignedProviderId}/${task.assignedModelId}`
        : undefined;
      return {
        answer: task.result.answer,
        ...(modelInfo ? { modelInfo } : {}),
      };
    },
    describeContext(context) {
      if (!isHtmlAnchorTarget(context)) return { label: 'HTML 内容' };
      const summary = summarizeHtmlAnchor(context);
      return {
        label: summary.kindLabel,
        ...(summary.detail ? { detail: summary.detail } : {}),
      };
    },
    revealContext: input.revealContext,
    onContextReleased: input.onContextReleased,
  };
  return Object.freeze(contribution);
}
