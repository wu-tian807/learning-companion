import { describe, expect, it } from 'vitest';

import {
  createWorkbenchLocationHref,
  parseWorkbenchLocationHref,
} from './location-reference';

describe('WorkbenchLocationReference', () => {
  it('round trips a revision-protected content target', () => {
    const reference = {
      version: 2 as const,
      projectId: 'project',
      assetId: 'asset',
      sourceRevision: 'source-v1',
      target: {
        scope: 'content' as const,
        targetType: 'video.time-range',
        targetVersion: 1,
        targetPayload: { startSeconds: 3, endSeconds: 9 },
      },
    };
    expect(parseWorkbenchLocationHref(createWorkbenchLocationHref(reference))).toEqual(reference);
  });

  it('allows whole-Asset links but rejects a content target without its snapshot revision', () => {
    const whole = {
      version: 2 as const,
      projectId: 'project',
      assetId: 'asset',
      target: { scope: 'asset' as const },
    };
    expect(parseWorkbenchLocationHref(createWorkbenchLocationHref(whole))).toEqual(whole);
    expect(
      parseWorkbenchLocationHref(
        '#learning-companion-location-v2=' +
          encodeURIComponent(JSON.stringify({
            ...whole,
            target: {
              scope: 'content', targetType: 'pdf.page', targetVersion: 1,
              targetPayload: { pageNumber: 1 },
            },
          })),
      ),
    ).toBeUndefined();
  });
});
