import { afterEach, describe, expect, it } from 'vitest';

import {
  clearWorkbenchLocationSnapshot,
  getLatestWorkbenchLocationSnapshot,
  publishWorkbenchLocationSnapshot,
  resetWorkbenchLocationSnapshotsForTests,
} from './location-snapshot-store';
import { markdownWorkbenchManifest } from '../../workbenches/markdown/shared';

afterEach(resetWorkbenchLocationSnapshotsForTests);

const reference = {
  version: 2 as const,
  projectId: 'project-a',
  assetId: 'asset-a',
  target: {
    scope: 'content' as const,
    targetType: 'test.range',
    targetVersion: 1,
    targetPayload: { exact: 'quoted text' },
  },
  sourceRevision: 'saved-revision',
};

describe('Workbench location snapshot store', () => {
  it('retains a frozen location export without native selection state', () => {
    publishWorkbenchLocationSnapshot(markdownWorkbenchManifest, {
      ownerId: 'material-session',
      projectId: 'project-a',
      reference,
      text: 'quoted text',
    });

    const snapshot = getLatestWorkbenchLocationSnapshot('project-a');

    expect(snapshot).toEqual({
      ownerId: 'material-session',
      projectId: 'project-a',
      reference,
      text: 'quoted text',
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.reference)).toBe(true);
  });

  it('clears only the requested owner and never crosses projects', () => {
    publishWorkbenchLocationSnapshot(markdownWorkbenchManifest, {
      ownerId: 'a', projectId: 'project-a', reference, text: 'A',
    });
    publishWorkbenchLocationSnapshot(markdownWorkbenchManifest, {
      ownerId: 'b', projectId: 'project-a', reference, text: 'B',
    });
    clearWorkbenchLocationSnapshot('project-a', 'b');

    expect(getLatestWorkbenchLocationSnapshot('project-a')).toBeUndefined();
    expect(getLatestWorkbenchLocationSnapshot('project-b')).toBeUndefined();
  });

  it('rejects a snapshot whose reference belongs to another project', () => {
    expect(() => publishWorkbenchLocationSnapshot(markdownWorkbenchManifest, {
      ownerId: 'session', projectId: 'project-b', reference, text: 'text',
    })).toThrow('位置快照能力');
  });

  it('requires a manifest to opt into selection location export', () => {
    expect(() => publishWorkbenchLocationSnapshot({
      ...markdownWorkbenchManifest,
      facilities: markdownWorkbenchManifest.facilities.filter(
        (facility) => facility.id !== 'core.export.location-reference',
      ),
    }, {
      ownerId: 'session', projectId: 'project-a', reference, text: 'text',
    })).toThrow('位置快照能力');
  });
});
