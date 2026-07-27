import { describe, expect, it } from 'vitest';

import {
  createHealthCheckResponse,
  isAddLocalAssetsRequest,
  isAssetIdRequest,
  isAssetSummary,
  isAssetSummaryList,
  isCreateProjectRequest,
  isDeleteProjectRequest,
  isHealthCheckResponse,
  isProjectSummary,
  isProjectSummaryList,
  isProjectLifecycleRequest,
  isRelinkAssetRequest,
  isRenameAssetRequest,
  isRenameProjectRequest,
  isSetProjectPinnedRequest,
  isUpdateHomePreferencesRequest,
} from './ipc';

describe('health check contract', () => {
  it('creates a serializable health response', () => {
    const now = new Date('2026-07-22T08:00:00.000Z');

    const response = createHealthCheckResponse('0.1.0', 'darwin', now);

    expect(response).toEqual({
      status: 'ok',
      appVersion: '0.1.0',
      platform: 'darwin',
      timestamp: '2026-07-22T08:00:00.000Z',
    });
    expect(isHealthCheckResponse(response)).toBe(true);
  });

  it('rejects malformed responses', () => {
    expect(isHealthCheckResponse(null)).toBe(false);
    expect(isHealthCheckResponse({ status: 'error' })).toBe(false);
    expect(
      isHealthCheckResponse({
        status: 'ok',
        appVersion: '0.1.0',
        platform: 'darwin',
        timestamp: 'not-a-date',
      }),
    ).toBe(false);
  });
});

describe('project summary contract', () => {
  const project = {
    id: 'machine-learning',
    name: '机器学习基础',
    icon: '🤖',
    createdTime: '2026-07-22T08:00:00.000Z',
    sources: ['source-1', 'source-2'],
    pinned: false,
  };

  it('accepts a serializable project list', () => {
    expect(isProjectSummary(project)).toBe(true);
    expect(isProjectSummaryList([project])).toBe(true);
  });

  it('rejects malformed projects', () => {
    expect(isProjectSummary({ ...project, name: '' })).toBe(false);
    expect(isProjectSummary({ ...project, createdTime: 'not-a-date' })).toBe(false);
    expect(isProjectSummary({ ...project, sources: [42] })).toBe(false);
    expect(isProjectSummary({ ...project, pinned: 'yes' })).toBe(false);
    expect(isProjectSummaryList([project, null])).toBe(false);
  });
});

describe('project mutation contracts', () => {
  it('accepts valid mutation requests', () => {
    expect(isCreateProjectRequest({ name: '新 Project' })).toBe(true);
    expect(isRenameProjectRequest({ id: 'project-1', name: '新标题' })).toBe(true);
    expect(isSetProjectPinnedRequest({ id: 'project-1', pinned: true })).toBe(true);
    expect(isDeleteProjectRequest({ id: 'project-1' })).toBe(true);
  });

  it('rejects malformed mutation requests', () => {
    expect(isCreateProjectRequest({ name: '' })).toBe(false);
    expect(isCreateProjectRequest({ icon: '📘' })).toBe(false);
    expect(isRenameProjectRequest({ id: '', name: '新标题' })).toBe(false);
    expect(isSetProjectPinnedRequest({ id: 'project-1', pinned: 'yes' })).toBe(false);
    expect(isDeleteProjectRequest(null)).toBe(false);
  });
});

describe('Asset contracts', () => {
  const asset = {
    id: 'asset',
    projectId: 'project',
    name: '学习笔记',
    mediaType: 'text/markdown',
    contentLocator: {
      kind: 'local-file',
      path: '/tmp/notes.md',
      availability: 'available',
      checkedTime: '2026-07-27T01:00:00.000Z',
    },
    createdTime: '2026-07-27T01:00:00.000Z',
    lastUsedTime: '2026-07-27T02:00:00.000Z',
  };

  it('accepts serializable Asset snapshots and requests', () => {
    expect(isAssetSummary(asset)).toBe(true);
    expect(isAssetSummaryList([asset])).toBe(true);
    expect(isProjectLifecycleRequest({ projectId: 'project' })).toBe(true);
    expect(isAddLocalAssetsRequest({ paths: ['/tmp/a.md', '/tmp/b.pdf'] })).toBe(
      true,
    );
    expect(
      isRenameAssetRequest({ assetId: 'asset', name: '新标题' }),
    ).toBe(true);
    expect(
      isRelinkAssetRequest({ assetId: 'asset', path: '/tmp/new.md' }),
    ).toBe(true);
    expect(isAssetIdRequest({ assetId: 'asset' })).toBe(true);
  });

  it('rejects malformed Asset snapshots and requests', () => {
    expect(
      isAssetSummary({
        ...asset,
        contentLocator: {
          ...asset.contentLocator,
          availability: 'offline',
        },
      }),
    ).toBe(false);
    expect(isAssetSummary({ ...asset, lastUsedTime: 'invalid' })).toBe(false);
    expect(isAssetSummaryList([asset, null])).toBe(false);
    expect(isProjectLifecycleRequest({ projectId: '' })).toBe(false);
    expect(isAddLocalAssetsRequest({ paths: [] })).toBe(false);
    expect(isRenameAssetRequest({ assetId: 'asset', name: '' })).toBe(false);
    expect(isRelinkAssetRequest({ assetId: '', path: '/tmp/new.md' })).toBe(
      false,
    );
    expect(isAssetIdRequest(null)).toBe(false);
  });
});

describe('settings mutation contracts', () => {
  it('accepts supported home preferences', () => {
    expect(
      isUpdateHomePreferencesRequest({
        viewMode: 'list',
        sortMode: 'title',
      }),
    ).toBe(true);
  });

  it('rejects malformed home preferences', () => {
    expect(isUpdateHomePreferencesRequest(null)).toBe(false);
    expect(
      isUpdateHomePreferencesRequest({
        viewMode: 'compact',
        sortMode: 'newest',
      }),
    ).toBe(false);
    expect(
      isUpdateHomePreferencesRequest({
        viewMode: 'grid',
        sortMode: 'popular',
      }),
    ).toBe(false);
  });
});
