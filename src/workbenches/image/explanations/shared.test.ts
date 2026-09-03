import { describe, expect, it } from 'vitest';

import {
  imageExplanationMarkerColor,
  isImageExplanationMetadata,
  isUpdateImageExplanationMarkerColorRequest,
} from './shared';

describe('image explanation metadata', () => {
  it('accepts legacy metadata with a blue default and validates custom colors', () => {
    const legacy = {
      format: 'learning-companion/image-explanation',
      version: 1,
      sourceRevision: 'revision-1',
    } as const;
    expect(isImageExplanationMetadata(legacy)).toBe(true);
    expect(imageExplanationMarkerColor(legacy)).toBe('blue');
    expect(isImageExplanationMetadata({ ...legacy, markerColor: 'red' })).toBe(true);
    expect(imageExplanationMarkerColor({ ...legacy, markerColor: 'yellow' })).toBe('yellow');
    expect(isImageExplanationMetadata({ ...legacy, markerColor: 'green' })).toBe(false);
  });

  it('accepts only revision-scoped marker-color updates', () => {
    const request = {
      projectId: 'project-1',
      assetId: 'asset-1',
      explanationId: 'attachment-1',
      sourceRevision: 'revision-1',
      markerColor: 'red',
    } as const;
    expect(isUpdateImageExplanationMarkerColorRequest(request)).toBe(true);
    expect(isUpdateImageExplanationMarkerColorRequest({ ...request, markerColor: 'green' })).toBe(false);
    expect(isUpdateImageExplanationMarkerColorRequest({ ...request, sourceRevision: '' })).toBe(false);
  });
});
