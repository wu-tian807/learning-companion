import { describe, expect, it } from 'vitest';

import { WorkbenchConversationInstruction } from '../../../main/conversation/workbench-conversation-instruction';
import type { GenerationTaskProcessContext } from '../../../main/generation/contracts/task-definition';
import type { PreparedGenerationAssetReferenceBindings } from '../../../main/generation/contracts/generation-asset-reference';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { MindMapConversationContextProvider } from './mindmap-conversation-context-provider';
import {
  MIND_MAP_CONVERSATION_CONTEXT_PROVIDER_ID,
  type MindMapConversationContext,
} from './mindmap-conversation-context';

const context: MindMapConversationContext = {
  format: 'learning-companion/mindmap-conversation-context',
  version: 1,
  nodeId: 'node-1',
  title: '节点一',
  focus: '理解节点一的核心概念',
  path: [
    { nodeId: 'root', title: '课程' },
    { nodeId: 'node-1', title: '节点一' },
  ],
  target: {
    scope: 'content',
    targetType: 'mindmap.node',
    targetVersion: 1,
    targetPayload: { nodeId: 'node-1' },
  },
  sourceRevision: 'mindmap-revision',
  references: [],
  relatedAssetIds: ['pdf-1'],
};

function createProcessContext(
  source: PreparedGenerationAssetReferenceBindings['source'],
): GenerationTaskProcessContext<WorkbenchConversationInstruction> {
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    instruction: new WorkbenchConversationInstruction({
      contextProviderId: MIND_MAP_CONVERSATION_CONTEXT_PROVIDER_ID,
      assetId: 'mindmap-1',
      conversationId: 'conversation-1',
      question: '请解释这个节点',
      context,
    }),
    workspaces: {
      primary: {
        key: 'workbench-conversation',
        instanceKey: 'conversation-1',
        path: 'C:/workspace/conversation-1',
        permissions: { read: true, write: false },
      },
      secondary: [],
    },
    assetReferences: { source },
    preparedUserMessage: { role: 'user', content: [{ type: 'text', text: 'question' }] },
    agent: { completedCalls: [], call: async () => { throw new Error('not called'); } },
    reportStatus: () => undefined,
    reportOutputRejected: () => undefined,
  };
}

function textOf(prepared: Awaited<ReturnType<MindMapConversationContextProvider['prepare']>>) {
  return prepared.userMessage.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

describe('Mind Map conversation context provider', () => {
  it('exposes node context and every prepared source as read-only input', async () => {
    const prepared = await new MindMapConversationContextProvider().prepare(
      createProcessContext([
        {
          alias: 'source-1',
          assetId: 'mindmap-1',
          name: '课程导图',
          mediaType: 'application/x-mindmap',
          contentRevision: 'mindmap-revision',
          relativePath: 'sources/mindmap.mindmap',
        },
        {
          alias: 'source-2',
          assetId: 'pdf-1',
          name: '课程资料.pdf',
          mediaType: 'application/pdf',
          contentRevision: 'pdf-revision',
          relativePath: 'sources/course.pdf',
        },
      ]),
    );

    expect(prepared.toolRequirements).toEqual([]);
    expect(textOf(prepared)).toContain('节点路径：课程 > 节点一');
    expect(textOf(prepared)).toContain('节点 focus：理解节点一的核心概念');
    expect(textOf(prepared)).toContain('sources/course.pdf');
    expect(textOf(prepared)).toContain('不要修改任何文件');
  });

  it('rejects a task whose primary source is not the Mind Map asset', async () => {
    const process = createProcessContext([]);
    await expect(new MindMapConversationContextProvider().prepare(process))
      .rejects.toThrow();
  });

  it('rejects a stale Mind Map or referenced source revision', async () => {
    const staleContext = {
      ...context,
      sourceRevision: 'older-mindmap-revision',
    };
    const process = createProcessContext([
      {
        alias: 'source-1',
        assetId: 'mindmap-1',
        name: '课程导图',
        mediaType: 'application/x-mindmap',
        contentRevision: 'mindmap-revision',
        relativePath: 'sources/mindmap.mindmap',
      },
    ]);
    const instruction = new WorkbenchConversationInstruction({
      contextProviderId: MIND_MAP_CONVERSATION_CONTEXT_PROVIDER_ID,
      assetId: 'mindmap-1',
      conversationId: 'conversation-1',
      question: '请解释这个节点',
      context: staleContext as unknown as JsonValue,
    });
    await expect(new MindMapConversationContextProvider().prepare({
      ...process,
      instruction,
    })).rejects.toThrow();
  });
});
