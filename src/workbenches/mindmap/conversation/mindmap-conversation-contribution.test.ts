import { describe, expect, it } from 'vitest';

import type { MindMapWorkbenchPayload } from '../shared';
import { createMindMapConversationContribution } from './mindmap-conversation-contribution';
import { isMindMapConversationContext } from './mindmap-conversation-context';

const payload = {
  document: {
    format: 'learning-companion/mindmap',
    version: 4,
    title: 'Map',
    rootNodeId: 'root',
    nodes: {
      root: { id: 'root', title: 'Root', focus: 'Overview', childIds: ['child'] },
      child: { id: 'child', title: 'Child', focus: 'Details', childIds: [] },
    },
    frames: {},
    associations: { nodes: {}, frames: {} },
  },
  revision: 'mindmap-revision',
  associations: {
    byNode: {
      child: {
        references: [{
          reference: {
            id: 'reference-1', projectId: 'project', assetId: 'mindmap',
            sourceAssetId: 'pdf-1', createdTime: 1,
          },
          binding: {
            referenceId: 'reference-1', contentRevision: 'pdf-revision',
            target: { scope: 'content', targetType: 'pdf.page', targetVersion: 1,
              targetPayload: { pageNumber: 4 } },
          },
        }],
        links: [],
      },
    },
    byFrame: {}, staleBindings: [],
  },
  viewState: { collapsedNodeIds: [] },
} satisfies MindMapWorkbenchPayload;

describe('Mind Map conversation contribution', () => {
  it('creates node context with path, Target and referenced source assets', () => {
    const contribution = createMindMapConversationContribution(payload);
    const context = contribution.createContext('child');
    expect(context).toBeDefined();
    expect(isMindMapConversationContext(context)).toBe(true);
    expect(context?.path.map(({ title }) => title)).toEqual(['Root', 'Child']);
    expect(contribution.contextAssetIds?.(context!)).toEqual(['pdf-1']);
    expect(context?.references[0]?.target).toEqual({
      scope: 'content', targetType: 'pdf.page', targetVersion: 1,
      targetPayload: { pageNumber: 4 },
    });
  });

  it('rejects nodes that are not reachable from the root', () => {
    const contribution = createMindMapConversationContribution(payload);
    expect(contribution.createContext('missing')).toBeUndefined();
  });
});
