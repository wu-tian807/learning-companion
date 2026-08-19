import { describe, expect, it } from 'vitest';

import { createImageRegionTarget } from '../shared';
import { findImageExplanationAtTarget } from './image-explanation-revision';
import type { ImageExplanationView } from './shared';

const target = createImageRegionTarget({
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  sourceWidth: 1000,
  sourceHeight: 800,
});

describe('image explanation revision projection', () => {
  it('does not treat a stale Attachment at the same coordinates as a duplicate', () => {
    const stale: ImageExplanationView = {
      kind: 'attachment',
      id: 'attachment-old',
      projectId: 'project-1',
      assetId: 'asset-1',
      target,
      status: 'completed',
      answer: '旧图片的解释',
      sourceRevision: 'revision-1',
      createdTime: 1,
      updatedTime: 1,
    };

    expect(
      findImageExplanationAtTarget([stale], target, 'revision-2'),
    ).toBeUndefined();
    expect(
      findImageExplanationAtTarget([stale], target, 'revision-1'),
    ).toBe(stale);
  });

  it('filters Tasks whose source revision is stale or still unknown', () => {
    const prepared: ImageExplanationView = {
      kind: 'task',
      id: 'task-prepared',
      projectId: 'project-1',
      assetId: 'asset-1',
      target,
      status: 'failed',
      sourceRevision: 'revision-1',
      createdTime: 1,
      updatedTime: 2,
    };
    const unprepared: ImageExplanationView = {
      ...prepared,
      id: 'task-unprepared',
      status: 'pending',
      sourceRevision: undefined,
    };

    expect(
      findImageExplanationAtTarget([prepared], target, 'revision-2'),
    ).toBeUndefined();
    expect(
      findImageExplanationAtTarget([unprepared], target, 'revision-2'),
    ).toBeUndefined();
  });
});
