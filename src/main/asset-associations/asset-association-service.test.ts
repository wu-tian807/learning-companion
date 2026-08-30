import { describe, expect, it, vi } from 'vitest';

import type {
  AssetLink,
  AssetReference,
} from '../../shared/asset-associations';
import type { AssetLookup } from '../assets/asset-database';
import { trackAssetAggregateMutations } from '../assets/asset-aggregate-mutation';
import type { ProjectLookup } from '../projects/project-database';
import {
  AssetAssociationService,
  type AssetAssociationServiceApi,
} from './asset-association-service';
import type { AssetLinkDatabaseApi } from './asset-link-database';
import type { AssetReferenceDatabaseApi } from './asset-reference-database';

interface Harness {
  readonly service: AssetAssociationServiceApi & AssetAssociationService;
  readonly referenceRows: AssetReference[];
  readonly linkRows: AssetLink[];
  readonly referenceCreate: ReturnType<typeof vi.fn>;
  readonly linkCreate: ReturnType<typeof vi.fn>;
  readonly failReferenceLoadFor: Set<string>;
}

function createHarness(): Harness {
  const projects = new Set(['project-a', 'project-b']);
  const assetsByProject = new Map([
    ['project-a', new Set(['map-a', 'pdf-a', 'lecture-a'])],
    ['project-b', new Set(['map-b', 'pdf-b'])],
  ]);
  const referenceRows: AssetReference[] = [];
  const linkRows: AssetLink[] = [];
  const failReferenceLoadFor = new Set<string>();
  let nextReferenceId = 0;
  let nextLinkId = 0;
  const referenceCreate = vi.fn(
    (projectId: string, assetId: string, input: { sourceAssetId: string }) => {
      const row: AssetReference = {
        id: `reference-${++nextReferenceId}`,
        projectId,
        assetId,
        sourceAssetId: input.sourceAssetId,
        createdTime: nextReferenceId,
      };
      referenceRows.push(row);
      return row;
    },
  );
  const linkCreate = vi.fn(
    (projectId: string, assetId: string, input: { targetAssetId: string }) => {
      const row: AssetLink = {
        id: `link-${++nextLinkId}`,
        projectId,
        assetId,
        targetAssetId: input.targetAssetId,
        createdTime: nextLinkId,
      };
      linkRows.push(row);
      return row;
    },
  );
  const referenceDatabase: AssetReferenceDatabaseApi = {
    listByProject: (projectId) => {
      if (failReferenceLoadFor.has(projectId)) {
        throw new Error('load failed');
      }
      return referenceRows.filter((row) => row.projectId === projectId);
    },
    listByAsset: (projectId, assetId) =>
      referenceRows.filter(
        (row) => row.projectId === projectId && row.assetId === assetId,
      ),
    create: referenceCreate,
    delete: (projectId, referenceId) => {
      const index = referenceRows.findIndex(
        (row) => row.projectId === projectId && row.id === referenceId,
      );
      if (index < 0) {
        throw new Error('missing reference');
      }
      referenceRows.splice(index, 1);
    },
  };
  const linkDatabase: AssetLinkDatabaseApi = {
    listByProject: (projectId) =>
      linkRows.filter((row) => row.projectId === projectId),
    listByAsset: (projectId, assetId) =>
      linkRows.filter(
        (row) => row.projectId === projectId && row.assetId === assetId,
      ),
    create: linkCreate,
    delete: (projectId, linkId) => {
      const index = linkRows.findIndex(
        (row) => row.projectId === projectId && row.id === linkId,
      );
      if (index < 0) {
        throw new Error('missing link');
      }
      linkRows.splice(index, 1);
    },
  };
  const projectLookup: ProjectLookup = {
    get: (projectId) =>
      projects.has(projectId) ? (Object.freeze({ id: projectId }) as never) : undefined,
  };
  const assetLookup: AssetLookup = {
    get: (projectId, assetId) =>
      assetsByProject.get(projectId)?.has(assetId)
        ? (Object.freeze({ id: assetId, projectId }) as never)
        : undefined,
  };

  return {
    service: new AssetAssociationService(
      referenceDatabase,
      linkDatabase,
      projectLookup,
      assetLookup,
      { now: () => 100 },
    ),
    referenceRows,
    linkRows,
    referenceCreate,
    linkCreate,
    failReferenceLoadFor,
  };
}

describe('AssetAssociationService', () => {
  it('loads and unloads one Project-scoped association snapshot', () => {
    const harness = createHarness();
    harness.referenceRows.push({
      id: 'reference',
      projectId: 'project-a',
      assetId: 'map-a',
      sourceAssetId: 'pdf-a',
      createdTime: 1,
    });
    harness.linkRows.push({
      id: 'link',
      projectId: 'project-a',
      assetId: 'map-a',
      targetAssetId: 'lecture-a',
      createdTime: 2,
    });

    harness.service.loadFromProject('project-a');

    expect(harness.service.getActiveProjectId()).toBe('project-a');
    expect(harness.service.listReferences('map-a')).toEqual(
      harness.referenceRows,
    );
    expect(harness.service.listLinks('map-a')).toEqual(harness.linkRows);

    harness.service.unloadProject();

    expect(harness.service.getActiveProjectId()).toBeUndefined();
    expect(() => harness.service.listReferences('map-a')).toThrow(
      'SERVICE_NOT_READY',
    );
  });

  it('commits a loaded snapshot atomically', () => {
    const harness = createHarness();
    harness.referenceRows.push({
      id: 'reference',
      projectId: 'project-a',
      assetId: 'map-a',
      sourceAssetId: 'pdf-a',
      createdTime: 1,
    });
    harness.service.loadFromProject('project-a');
    harness.failReferenceLoadFor.add('project-b');

    expect(() => harness.service.loadFromProject('project-b')).toThrow(
      'load failed',
    );
    expect(harness.service.getActiveProjectId()).toBe('project-a');
    expect(harness.service.getReference('reference')).toEqual(
      harness.referenceRows[0],
    );
  });

  it('ensures unique relations and keeps memory synchronized with writes', () => {
    const harness = createHarness();
    harness.service.loadFromProject('project-a');
    const assets = { touch: vi.fn() };
    const dispose = trackAssetAggregateMutations(assets, [harness.service]);

    const reference = harness.service.ensureReference('map-a', {
      sourceAssetId: 'pdf-a',
    });
    const sameReference = harness.service.ensureReference('map-a', {
      sourceAssetId: 'pdf-a',
    });
    const link = harness.service.ensureLink('map-a', {
      targetAssetId: 'lecture-a',
    });
    const sameLink = harness.service.ensureLink('map-a', {
      targetAssetId: 'lecture-a',
    });

    expect(sameReference).toEqual(reference);
    expect(sameLink).toEqual(link);
    expect(harness.referenceCreate).toHaveBeenCalledOnce();
    expect(harness.linkCreate).toHaveBeenCalledOnce();
    expect(harness.service.listReferences('map-a')).toEqual([reference]);
    expect(harness.service.listLinks('map-a')).toEqual([link]);

    harness.service.deleteReference(reference.id);
    harness.service.deleteLink(link.id);
    harness.service.deleteReference(reference.id);
    harness.service.deleteLink(link.id);

    expect(harness.service.listReferences('map-a')).toEqual([]);
    expect(harness.service.listLinks('map-a')).toEqual([]);
    expect(harness.referenceRows).toEqual([]);
    expect(harness.linkRows).toEqual([]);
    expect(assets.touch).toHaveBeenCalledTimes(4);
    expect(assets.touch).toHaveBeenNthCalledWith(
      1,
      'project-a',
      'map-a',
      1,
    );
    expect(assets.touch).toHaveBeenNthCalledWith(
      2,
      'project-a',
      'map-a',
      1,
    );
    expect(assets.touch).toHaveBeenNthCalledWith(
      3,
      'project-a',
      'map-a',
      100,
    );
    expect(assets.touch).toHaveBeenNthCalledWith(
      4,
      'project-a',
      'map-a',
      100,
    );
    dispose();
  });

  it('rejects missing, cross-Project, and self-related Assets', () => {
    const harness = createHarness();
    harness.service.loadFromProject('project-a');
    const mutation = vi.fn();
    harness.service.subscribeAssetMutations(mutation);

    expect(() =>
      harness.service.ensureReference('map-a', {
        sourceAssetId: 'pdf-b',
      }),
    ).toThrow('ASSET_NOT_FOUND');
    expect(() =>
      harness.service.ensureReference('map-a', {
        sourceAssetId: 'map-a',
      }),
    ).toThrow('DATA_INTEGRITY_ERROR');
    expect(() =>
      harness.service.ensureLink('map-a', { targetAssetId: 'map-a' }),
    ).toThrow('DATA_INTEGRITY_ERROR');
    expect(mutation).not.toHaveBeenCalled();
  });

  it('touches surviving owners when related Assets are deleted', () => {
    const harness = createHarness();
    harness.service.loadFromProject('project-a');
    harness.service.ensureReference('map-a', { sourceAssetId: 'pdf-a' });
    harness.service.ensureLink('map-a', { targetAssetId: 'lecture-a' });
    const mutations: unknown[] = [];
    harness.service.subscribeAssetMutations((mutation) => {
      mutations.push(mutation);
    });

    harness.service.onAssetDeleted('project-a', 'pdf-a');
    harness.service.onAssetDeleted('project-a', 'lecture-a');

    expect(harness.service.getReference('reference-1')).toBeUndefined();
    expect(harness.service.getLink('link-1')).toBeUndefined();
    expect(mutations).toEqual([
      { projectId: 'project-a', assetId: 'map-a', updatedTime: 100 },
      { projectId: 'project-a', assetId: 'map-a', updatedTime: 100 },
    ]);
  });

  it('does not touch either endpoint when the owner itself is deleted', () => {
    const harness = createHarness();
    harness.service.loadFromProject('project-a');
    harness.service.ensureReference('map-a', { sourceAssetId: 'pdf-a' });
    harness.service.ensureLink('map-a', { targetAssetId: 'lecture-a' });
    const mutation = vi.fn();
    harness.service.subscribeAssetMutations(mutation);

    harness.service.onAssetDeleted('project-a', 'map-a');

    expect(mutation).not.toHaveBeenCalled();
  });

  it('contains rejected async mutation subscribers', async () => {
    const harness = createHarness();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    harness.service.loadFromProject('project-a');
    harness.service.subscribeAssetMutations(async () => {
      throw new Error('subscriber failed');
    });

    harness.service.ensureReference('map-a', { sourceAssetId: 'pdf-a' });
    await Promise.resolve();

    expect(error).toHaveBeenCalledWith(
      '异步 Asset Association 事件订阅者执行失败',
      expect.any(Error),
    );
    error.mockRestore();
  });
});
