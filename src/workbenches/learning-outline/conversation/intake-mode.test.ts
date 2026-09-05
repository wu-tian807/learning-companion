import { describe, expect, it } from 'vitest';

import { learningOutlineIntakeMode } from './intake-mode';

describe('learning outline intake mode', () => {
  it('carries the selected source and its referenced materials into the task', () => {
    const request = learningOutlineIntakeMode.task.createRequest({
      projectId: 'project-1',
      boundAssetId: 'outline-1',
      assetId: 'mindmap-1',
      conversationId: 'conversation-1',
      question: '我想学习这个主题',
      context: { nodeId: 'node-1' },
      contextSource: {
        contextProviderId: 'mindmap.node',
        assetId: 'mindmap-1',
        sourceAssetMode: 'reference',
        contextAssetIds: ['pdf-1', 'mindmap-1'],
      },
      generateTitle: false,
    });

    expect(request.instruction).toMatchObject({
      boundAssetId: 'outline-1',
      conversationId: 'conversation-1',
    });
    expect(request.assetReferences).toEqual({
      source: [{ assetId: 'mindmap-1' }, { assetId: 'pdf-1' }],
    });
  });

  it('passes the first-question title request into the task instruction', () => {
    const request = learningOutlineIntakeMode.task.createRequest({
      projectId: 'project-1',
      boundAssetId: 'outline-1',
      conversationId: 'conversation-1',
      question: '我想从基础开始学习',
      generateTitle: true,
    });

    expect(request.instruction).toMatchObject({ generateTitle: true });
  });
});
