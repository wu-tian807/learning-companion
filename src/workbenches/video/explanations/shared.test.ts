import { describe, expect, it } from 'vitest';

import { createVideoFrameRegionTarget } from '../shared';
import {
  isVideoExplanationEvent,
  isVideoExplanationMetadata,
  isVideoExplanationView,
} from './shared';

const target = createVideoFrameRegionTarget({
  timeSeconds: 2.5,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  sourceWidth: 1_920,
  sourceHeight: 1_080,
});

describe('video explanation contracts', () => {
  it('requires a source revision and original question in metadata', () => {
    expect(
      isVideoExplanationMetadata({
        format: 'learning-companion/video-explanation',
        version: 1,
        sourceRevision: 'revision-1',
        question: '这里在讲什么？',
        conversationId: 'conversation-1',
      }),
    ).toBe(true);
    expect(
      isVideoExplanationMetadata({
        format: 'learning-companion/video-explanation',
        version: 1,
        sourceRevision: 'revision-1',
        question: '旧标注仍然可读',
      }),
    ).toBe(true);
    expect(
      isVideoExplanationMetadata({
        format: 'learning-companion/video-explanation',
        version: 1,
        sourceRevision: 'revision-1',
      }),
    ).toBe(false);
  });

  it('rejects malformed views and cross-asset replacement events', () => {
    const explanation = {
      kind: 'attachment',
      id: 'attachment-1',
      projectId: 'project-1',
      assetId: 'asset-1',
      target,
      sourceRevision: 'revision-1',
      question: '这里在讲什么？',
      conversationId: 'conversation-1',
      status: 'completed',
      answer: '回答',
      createdTime: 1,
      updatedTime: 1,
    } as const;
    expect(isVideoExplanationView(explanation)).toBe(true);
    expect(
      isVideoExplanationView({ ...explanation, question: '' }),
    ).toBe(false);
    expect(
      isVideoExplanationView({ ...explanation, conversationId: '' }),
    ).toBe(false);
    expect(
      isVideoExplanationEvent({
        type: 'replaced',
        projectId: 'project-1',
        assetId: 'asset-2',
        previousExplanationId: 'task-1',
        explanation,
      }),
    ).toBe(false);
  });
});
