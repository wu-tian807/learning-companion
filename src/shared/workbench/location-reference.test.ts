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

  it('rejects an oversized opaque Target before emitting an unreadable href', () => {
    expect(() =>
      createWorkbenchLocationHref({
        version: 2,
        projectId: 'project',
        assetId: 'asset',
        sourceRevision: 'v1',
        target: {
          scope: 'content',
          targetType: 'test.opaque',
          targetVersion: 1,
          targetPayload: { payload: 'x'.repeat(100_000) },
        },
      }),
    ).toThrow('超过可保存的链接长度');
  });
});
