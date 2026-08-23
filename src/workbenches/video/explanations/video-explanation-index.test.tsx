import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createVideoFrameRegionTarget } from '../shared';
import {
  VideoExplanationIndex,
  orderVideoExplanations,
} from './video-explanation-index';
import type { VideoExplanationView } from './shared';

const later: VideoExplanationView = {
  kind: 'task',
  id: 'task-later',
  projectId: 'project-1',
  assetId: 'asset-1',
  target: createVideoFrameRegionTarget({
    timeSeconds: 20,
    x: 0.5,
    y: 0.1,
    width: 0.2,
    height: 0.3,
    sourceWidth: 100,
    sourceHeight: 100,
  }),
  sourceRevision: 'revision-1',
  question: '后面讲了什么？',
  status: 'pending',
  createdTime: 1,
  updatedTime: 1,
};
const earlier: VideoExplanationView = {
  kind: 'attachment',
  id: 'attachment-earlier',
  projectId: 'project-1',
  assetId: 'asset-1',
  target: createVideoFrameRegionTarget({
    timeSeconds: 5,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    sourceWidth: 100,
    sourceHeight: 100,
  }),
  sourceRevision: 'revision-1',
  question: '公式中的 λ 是什么？',
  status: 'completed',
  answer: '它是正则化强度。',
  createdTime: 2,
  updatedTime: 2,
};

describe('VideoExplanationIndex', () => {
  it('orders marker numbers by media time and shows the original question', () => {
    expect(orderVideoExplanations([later, earlier]).map((item) => item.id)).toEqual([
      'attachment-earlier',
      'task-later',
    ]);
    const markup = renderToStaticMarkup(
      <VideoExplanationIndex
        explanations={[later, earlier]}
        activeExplanationId="attachment-earlier"
        onActivate={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(markup).toContain('标注 1');
    expect(markup).toContain('0:05');
    expect(markup).toContain('公式中的 λ 是什么？');
    expect(markup).toContain('后面讲了什么？');
  });
});
