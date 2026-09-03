import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createImageRegionTarget } from '../shared';
import { ImageExplanationMarkerOverlay } from './image-explanation-marker-overlay';
import type { ImageExplanationView } from './shared';

const explanation: ImageExplanationView = {
  kind: 'attachment',
  id: 'explanation-1',
  projectId: 'project-1',
  assetId: 'asset-1',
  target: createImageRegionTarget({
    x: 0.1, y: 0.2, width: 0.3, height: 0.4, sourceWidth: 1000, sourceHeight: 800,
  }),
  status: 'completed',
  answer: '解释',
  sourceRevision: 'revision-1',
  createdTime: 1,
  updatedTime: 2,
};

const markers = [{
  explanation,
  number: 1,
  points: '10,20 40,20 40,60 10,60',
  markerPosition: { x: 10, y: 20 },
}] as const;

describe('ImageExplanationMarkerOverlay', () => {
  it('renders saved region borders and numbers while visible', () => {
    const markup = renderToStaticMarkup(
      <ImageExplanationMarkerOverlay visible markers={markers} onActivate={vi.fn()} />,
    );
    expect(markup).toContain('data-explanation-marker="explanation-1"');
    expect(markup).toContain('>1</text>');
  });

  it('removes saved markers while hidden but keeps a new selection visible', () => {
    const markup = renderToStaticMarkup(
      <ImageExplanationMarkerOverlay
        visible={false}
        markers={markers}
        selectedPolygon="1,2 3,2 3,4 1,4"
        onActivate={vi.fn()}
      />,
    );
    expect(markup).not.toContain('data-explanation-marker');
    expect(markup).not.toContain('>1</text>');
    expect(markup).toContain('data-current-selection="true"');
  });

  it('uses the saved color and separates colliding number badges', () => {
    const markup = renderToStaticMarkup(
      <ImageExplanationMarkerOverlay
        visible
        markers={[
          ...markers,
          {
            ...markers[0],
            explanation: { ...explanation, id: 'explanation-2', markerColor: 'red' },
            number: 2,
          },
        ]}
        onActivate={vi.fn()}
      />,
    );
    expect(markup).toContain('stroke="#ef4444"');
    expect(markup).toContain('data-marker-leader="explanation-2"');
    const badgeCenters = [...markup.matchAll(/data-marker-badge="[^"]+" cx="([^"]+)" cy="([^"]+)"/g)]
      .map((match) => `${match[1]},${match[2]}`);
    expect(new Set(badgeCenters).size).toBe(2);
  });
});
