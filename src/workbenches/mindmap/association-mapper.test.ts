import { describe, expect, it } from 'vitest';

import type {
  AssetLink,
  AssetReference,
} from '../../shared/asset-associations';
import {
  resolveMindMapAssociations,
  type MindMapAssociationLookup,
} from './association-mapper';
import {
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
  type MindMapDocument,
} from './document';

function createDocument(): MindMapDocument {
  return {
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION,
    title: 'Map',
    rootNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        title: 'Root',
        focus: 'Root topic',
        childIds: ['child'],
      },
      child: {
        id: 'child',
        title: 'Child',
        focus: 'Child topic',
        childIds: [],
      },
    },
    frames: {
      chapter: {
        id: 'chapter',
        title: 'Chapter',
        nodeIds: ['root', 'child'],
      },
    },
    associations: {
      nodes: {
        root: {
          references: [
            {
              referenceId: 'reference',
              contentRevision: 'revision-1',
              target: { scope: 'asset' },
            },
            {
              referenceId: 'missing-reference',
              contentRevision: 'revision-1',
              target: { scope: 'asset' },
            },
          ],
          links: [{
            linkId: 'foreign-link',
            contentRevision: 'revision-1',
            target: { scope: 'asset' },
          }],
        },
      },
      frames: {
        chapter: {
          references: [],
          links: [
            { linkId: 'link', contentRevision: 'revision-1', target: { scope: 'asset' } },
            { linkId: 'missing-link', contentRevision: 'revision-1', target: { scope: 'asset' } },
          ],
        },
      },
    },
  };
}

function createDocumentWithRepeatedTargets(): MindMapDocument {
  return {
    ...createDocument(),
    associations: {
      nodes: {
        root: {
          references: [2, 5].map((pageNumber) => ({
            referenceId: 'reference',
            contentRevision: 'revision-2',
            target: {
              scope: 'content' as const,
              targetType: 'pdf.page',
              targetVersion: 1,
              targetPayload: { pageNumber },
            },
          })),
          links: [],
        },
      },
      frames: {},
    },
  };
}

describe('resolveMindMapAssociations', () => {
  it('resolves repeated Targets without collapsing them', () => {
    const reference: AssetReference = {
      id: 'reference',
      projectId: 'project',
      assetId: 'mindmap',
      sourceAssetId: 'pdf',
      createdTime: 1,
    };
    const resolved = resolveMindMapAssociations(
      'mindmap',
      createDocumentWithRepeatedTargets(),
      {
        getReference: (id) => id === reference.id ? reference : undefined,
        getLink: () => undefined,
      },
    );

    expect(resolved.byNode.root.references).toEqual([2, 5].map(
      (pageNumber) => ({
        reference,
        binding: {
          referenceId: 'reference',
          contentRevision: 'revision-2',
          target: {
            scope: 'content',
            targetType: 'pdf.page',
            targetVersion: 1,
            targetPayload: { pageNumber },
          },
        },
      }),
    ));
    expect(Object.isFrozen(resolved.byNode.root.references[0])).toBe(true);
  });

  it('joins sparse Node and Frame rows and reports stale bindings', () => {
    const references = new Map<string, AssetReference>([
      ['reference', {
        id: 'reference',
        projectId: 'project',
        assetId: 'mindmap',
        sourceAssetId: 'pdf',
        createdTime: 1,
      }],
    ]);
    const links = new Map<string, AssetLink>([
      ['link', {
        id: 'link',
        projectId: 'project',
        assetId: 'mindmap',
        targetAssetId: 'lecture',
        createdTime: 2,
      }],
      ['foreign-link', {
        id: 'foreign-link',
        projectId: 'project',
        assetId: 'other-map',
        targetAssetId: 'lecture',
        createdTime: 3,
      }],
    ]);
    const lookup: MindMapAssociationLookup = {
      getReference: (id) => references.get(id),
      getLink: (id) => links.get(id),
    };

    const resolved = resolveMindMapAssociations('mindmap', createDocument(), lookup);

    expect(resolved.byNode.root.references).toHaveLength(1);
    expect(resolved.byNode.root.references[0]).toMatchObject({
      reference: { id: 'reference' },
      binding: {
        referenceId: 'reference',
        contentRevision: 'revision-1',
        target: { scope: 'asset' },
      },
    });
    expect(resolved.byNode.child).toBeUndefined();
    expect(resolved.byFrame.chapter.links.map(({ link }) => link.id)).toEqual(['link']);
    expect(resolved.staleBindings).toEqual([
      {
        subjectKind: 'node',
        subjectId: 'root',
        kind: 'reference',
        associationId: 'missing-reference',
      },
      {
        subjectKind: 'node',
        subjectId: 'root',
        kind: 'link',
        associationId: 'foreign-link',
      },
      {
        subjectKind: 'frame',
        subjectId: 'chapter',
        kind: 'link',
        associationId: 'missing-link',
      },
    ]);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.byFrame.chapter.links)).toBe(true);
  });
});
