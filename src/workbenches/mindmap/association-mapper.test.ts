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
  type MindMapDocumentV1,
} from './shared';

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
        childIds: [],
      },
    },
    nodeAssociations: {
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
        linkIds: ['link', 'foreign-link', 'missing-link'],
      },
    },
  };
}

describe('resolveMindMapAssociations', () => {
  it('joins valid rows and reports stale or foreign bindings', () => {
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
    expect(resolved.byNode.root.links.map(({ id }) => id)).toEqual([
      'link',
    ]);
    expect(resolved.staleBindings).toEqual([
      {
        nodeId: 'root',
        kind: 'reference',
        associationId: 'missing-reference',
      },
      {
        nodeId: 'root',
        kind: 'link',
        associationId: 'foreign-link',
      },
      {
        nodeId: 'root',
        kind: 'link',
        associationId: 'missing-link',
      },
    ]);
    expect(Object.isFrozen(resolved)).toBe(true);
  });
});
