import { describe, expect, it } from 'vitest';

import {
  createOfficePreparePreviewCommand,
  isOfficeMediaType,
  isOfficeWorkbenchPayload,
  OFFICE_MEDIA_TYPES,
} from './shared';

describe('Office Workbench shared contract', () => {
  it('covers Word and PowerPoint legacy and OpenXML media types', () => {
    expect(OFFICE_MEDIA_TYPES).toHaveLength(4);
    expect(isOfficeMediaType('application/msword')).toBe(true);
    expect(
      isOfficeMediaType(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toBe(true);
    expect(isOfficeMediaType('application/pdf')).toBe(false);
  });

  it('validates pending and ready payloads', () => {
    const viewState = {
      readingMode: 'continuous',
      pageNumber: 1,
      pageOffsetRatio: 0,
      scaleMode: 'page-width',
      customScale: 1,
      rotation: 0,
      sidebar: 'closed',
    };

    expect(
      isOfficeWorkbenchPayload({
        status: 'runtime-required',
        viewState,
      }),
    ).toBe(true);
    expect(
      isOfficeWorkbenchPayload({
        status: 'ready',
        contentUrl: 'learning-content://resource/preview',
        viewState,
      }),
    ).toBe(true);
    expect(createOfficePreparePreviewCommand()).toEqual({
      type: 'office:prepare-preview',
    });
  });
});
