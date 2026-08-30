import { describe, expect, it, vi } from 'vitest';

import { createEpubCfiRangeTarget } from './shared';
import { renderEpubAnnotationWaves } from './epub-annotation-renderer';

const target = createEpubCfiRangeTarget({
  cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:8)',
  quote: { exact: '同一段原文', prefix: '', suffix: '' },
});

describe('EPUB annotation renderer', () => {
  it('keeps an AI wave and a note wave distinct at the same CFI', () => {
    const annotations = {
      underline: vi.fn(),
      highlight: vi.fn(),
      remove: vi.fn(),
    };

    const cleanup = renderEpubAnnotationWaves(
      annotations,
      [
        {
          kind: 'attachment',
          id: 'explanation-1',
          projectId: 'project-1',
          assetId: 'asset-1',
          target,
          status: 'completed',
          answer: '解释',
          markerColor: 'red',
          createdTime: 1,
          updatedTime: 1,
        },
      ],
      [
        {
          id: 'note-1',
          projectId: 'project-1',
          assetId: 'asset-1',
          target,
          text: '笔记',
          markerColor: 'yellow',
          createdTime: 1,
          updatedTime: 1,
        },
      ],
      { onExplanationClick: vi.fn(), onNoteClick: vi.fn() },
    );

    expect(annotations.underline).toHaveBeenCalledOnce();
    expect(annotations.highlight).toHaveBeenCalledOnce();
    expect(annotations.underline.mock.calls[0]?.[4]).toMatchObject({
      transform: 'translate(0 0)',
      'data-epub-wave-color': '#ef4444',
      'data-epub-wave-source': 'line',
    });
    expect(annotations.highlight.mock.calls[0]?.[4]).toMatchObject({
      transform: 'translate(0 3)',
      'data-epub-wave-color': '#eab308',
      'data-epub-wave-source': 'rect',
    });

    cleanup();
    expect(annotations.remove).toHaveBeenCalledWith(
      target.anchorPayload.cfiRange,
      'underline',
    );
    expect(annotations.remove).toHaveBeenCalledWith(
      target.anchorPayload.cfiRange,
      'highlight',
    );
  });
});
