import { describe, expect, it } from 'vitest';

import { createVideoFrameRegionTarget } from '../shared';
import {
  isVideoExplanationForRevision,
  videoExplanationVisibleAtTime,
} from './video-explanation-revision';

const explanation = {
  kind: 'task',
  id: 'task-1',
  projectId: 'project-1',
  assetId: 'asset-1',
  target: createVideoFrameRegionTarget({
    timeSeconds: 10,
    x: 0,
    y: 0,
    width: 0.5,
    height: 0.5,
    sourceWidth: 100,
    sourceHeight: 100,
  }),
  sourceRevision: 'revision-1',
  question: '解释这里',
  status: 'pending',
  createdTime: 1,
  updatedTime: 1,
} as const;

describe('video explanation revision and timeline visibility', () => {
  it('keeps markers revision-bound', () => {
    expect(isVideoExplanationForRevision(explanation, 'revision-1')).toBe(true);
    expect(isVideoExplanationForRevision(explanation, 'revision-2')).toBe(false);
  });

  it('shows a marker only at its real timestamp tolerance', () => {
    expect(videoExplanationVisibleAtTime(explanation, 10)).toBe(true);
    expect(videoExplanationVisibleAtTime(explanation, 10.25)).toBe(true);
    expect(videoExplanationVisibleAtTime(explanation, 10.251)).toBe(false);
    expect(videoExplanationVisibleAtTime(explanation, Number.NaN)).toBe(false);
  });
});
