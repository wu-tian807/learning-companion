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
  MIND_MAP_DOCUMENT_VERSION_V2,
  type MindMapDocumentV1,
  type MindMapDocumentV2,
} from './document';

function createDocument(): MindMapDocumentV1 {
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
              sourceTarget: { scope: 'asset' },
            },
            {
              referenceId: 'missing-reference',
              sourceTarget: { scope: 'asset' },
            },
          ],
          linkIds: ['foreign-link'],
        },
      },
      frames: {
        chapter: {
          references: [],
          linkIds: ['link', 'missing-link'],
        },
      },
    },
  };
}

function createDocumentV2(): MindMapDocumentV2 {
  const legacy = createDocument();

  return {
    ...legacy,
    version: MIND_MAP_DOCUMENT_VERSION_V2,
    associations: {
      nodes: {
        root: {
          references: [
            {
              referenceId: 'reference',
              sourceRevision: 'revision-1',
              agentLocator: { page: 2, quote: 'first location' },
            },
            {
              referenceId: 'reference',
              sourceRevision: 'revision-1',
              agentLocator: { page: 5, quote: 'second location' },
            },
          ],
          linkIds: [],
        },
      },
      frames: {},
    },
  };
}

describe('resolveMindMapAssociations', () => {
  it('resolves repeated Agent locators without collapsing them', () => {
    const reference: AssetReference = {
      id: 'reference',
      projectId: 'project',
      assetId: 'mindmap',
      sourceAssetId: 'pdf',
      createdTime: 1,
    };
    const resolved = resolveMindMapAssociations(
      'mindmap',
      createDocumentV2(),
      {
        getReference: (id) =>
          id === reference.id ? reference : undefined,
        getLink: () => undefined,
      },
    );

    expect(resolved.byNode.root.references).toHaveLength(2);
    expect(resolved.byNode.root.references).toEqual([
      {
        reference,
        sourceRevision: 'revision-1',
        agentLocator: { page: 2, quote: 'first location' },
      },
      {
        reference,
        sourceRevision: 'revision-1',
        agentLocator: { page: 5, quote: 'second location' },
      },
    ]);
    expect(
      Object.isFrozen(resolved.byNode.root.references[0]),
    ).toBe(true);
  });

  it('joins sparse Node and Frame rows and reports stale bindings', () => {
    const references = new Map<string, AssetReference>([
      [
        'reference',
        {
          id: 'reference',
          projectId: 'project',
          assetId: 'mindmap',
          sourceAssetId: 'pdf',
          createdTime: 1,
        },
      ],
    ]);
    const links = new Map<string, AssetLink>([
      [
        'link',
        {
          id: 'link',
          projectId: 'project',
          assetId: 'mindmap',
          targetAssetId: 'lecture',
          createdTime: 2,
        },
      ],
      [
        'foreign-link',
        {
          id: 'foreign-link',
          projectId: 'project',
          assetId: 'other-map',
          targetAssetId: 'lecture',
          createdTime: 3,
        },
      ],
    ]);
    const lookup: MindMapAssociationLookup = {
      getReference: (id) => references.get(id),
      getLink: (id) => links.get(id),
    };

    const resolved = resolveMindMapAssociations(
      'mindmap',
      createDocument(),
      lookup,
    );

    expect(resolved.byNode.root.references).toHaveLength(1);
    expect(resolved.byNode.root.references[0].reference.id).toBe(
      'reference',
    );
    expect(resolved.byNode.child).toBeUndefined();
    expect(resolved.byFrame.chapter.links.map(({ id }) => id)).toEqual([
      'link',
    ]);
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
