import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createVideoFrameRegionTarget } from '../shared';
import { VideoExplanationMarkerOverlay } from './video-explanation-marker-overlay';
import type { VideoExplanationView } from './shared';

const target = createVideoFrameRegionTarget({
  timeSeconds: 5,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  sourceWidth: 100,
  sourceHeight: 100,
});
const explanation: VideoExplanationView = {
  kind: 'attachment',
  id: 'attachment-1',
  projectId: 'project-1',
  assetId: 'asset-1',
  target,
  sourceRevision: 'revision-1',
  question: '解释这里',
  status: 'completed',
  answer: '回答',
  createdTime: 1,
  updatedTime: 1,
};

describe('VideoExplanationMarkerOverlay', () => {
  it('hides persisted markers independently from the active selection', () => {
    const visible = renderToStaticMarkup(
      <VideoExplanationMarkerOverlay
        visible
        markers={[{ explanation, number: 1 }]}
        onActivate={vi.fn()}
      />,
    );
    expect(visible).toContain('data-explanation-marker="attachment-1"');
    expect(visible).toContain('>1</span>');

    const hidden = renderToStaticMarkup(
      <VideoExplanationMarkerOverlay
        visible={false}
        markers={[{ explanation, number: 1 }]}
        selectedTarget={target}
        onActivate={vi.fn()}
      />,
    );
    expect(hidden).not.toContain('data-explanation-marker');
    expect(hidden).toContain('data-current-selection="true"');
  });
});
